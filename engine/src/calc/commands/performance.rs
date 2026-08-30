use super::*;

// ---------- compute_build_performance command ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildPerformanceInput {
    #[serde(default)]
    pub class_id: Option<String>,
    #[serde(default)]
    pub level: u32,
    #[serde(default)]
    pub allocated_attrs: HashMap<String, u32>,
    #[serde(default)]
    pub inventory: Inventory,
    #[serde(default)]
    pub skill_ranks: HashMap<String, u32>,
    #[serde(default)]
    pub subskill_ranks: HashMap<String, u32>,
    #[serde(default)]
    pub active_aura_id: Option<String>,
    #[serde(default)]
    pub active_buffs: HashMap<String, bool>,
    #[serde(default)]
    pub custom_stats: Vec<CustomStat>,
    #[serde(default)]
    pub allocated_tree_nodes: HashSet<u32>,
    #[serde(default)]
    pub tree_socketed: HashMap<u32, TreeSocketContent>,
    #[serde(default)]
    pub main_skill_id: Option<String>,
    #[serde(default)]
    pub enemy_conditions: HashMap<String, bool>,
    #[serde(default)]
    pub player_conditions: HashMap<String, bool>,
    #[serde(default)]
    pub skill_projectiles: HashMap<String, u32>,
    #[serde(default)]
    pub enemy_resistances: HashMap<String, f64>,
    #[serde(default)]
    pub proc_toggles: HashMap<String, bool>,
    #[serde(default)]
    pub kills_per_sec: f64,
    #[serde(default)]
    pub entity_rates: HashMap<String, f64>,
    #[serde(default)]
    pub season: Option<String>,
    #[serde(default)]
    pub granted_skill_ranks: HashMap<String, calc::Ranged>,
}

pub(crate) fn perf_deps<'a>(
    input: &'a BuildPerformanceInput,
    inventory: &'a Inventory,
    main_skill_id: Option<&'a str>,
) -> BuildPerformanceDeps<'a> {
    BuildPerformanceDeps {
        class_id: input.class_id.as_deref(),
        level: input.level,
        allocated_attrs: &input.allocated_attrs,
        inventory,
        skill_ranks: &input.skill_ranks,
        subskill_ranks: &input.subskill_ranks,
        active_aura_id: input.active_aura_id.as_deref(),
        active_buffs: &input.active_buffs,
        custom_stats: &input.custom_stats,
        allocated_tree_nodes: &input.allocated_tree_nodes,
        tree_socketed: &input.tree_socketed,
        main_skill_id,
        enemy_conditions: &input.enemy_conditions,
        player_conditions: &input.player_conditions,
        skill_projectiles: &input.skill_projectiles,
        enemy_resistances: &input.enemy_resistances,
        proc_toggles: &input.proc_toggles,
        kills_per_sec: input.kills_per_sec,
        entity_rates: &input.entity_rates,
        granted_skill_ranks: Some(&input.granted_skill_ranks),
    }
}

#[tauri::command]
pub fn calc_build_performance(input: BuildPerformanceInput) -> BuildPerformance {
    let _scope = crate::calc::season::SeasonScope::enter(input.season.clone());
    compute_build_performance(&perf_deps(
        &input,
        &input.inventory,
        input.main_skill_id.as_deref(),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RankSlotItemsInput {
    pub perf: BuildPerformanceInput,
    pub slot: String,
    pub base_ids: Vec<String>,
    #[serde(default)]
    pub active_skill_ids: Vec<String>,
}

// Ranks candidate bases for one slot by combined-DPS midpoint; multi-skill sums
// avg-hit DPS per active skill and counts proc DPS once (mirrors the frontend).
#[tauri::command]
pub fn rank_slot_items(input: RankSlotItemsInput) -> HashMap<String, f64> {
    let _scope = crate::calc::season::SeasonScope::enter(input.perf.season.clone());
    let mid = |a: Option<f64>, b: Option<f64>| match (a, b) {
        (Some(x), Some(y)) => Some((x + y) / 2.0),
        _ => None,
    };
    let mut out: HashMap<String, f64> = HashMap::with_capacity(input.base_ids.len());
    for base_id in &input.base_ids {
        let mut inventory = input.perf.inventory.clone();
        inventory.insert(
            input.slot.clone(),
            EquippedItem {
                base_id: base_id.clone(),
                ..Default::default()
            },
        );
        let dps = if input.active_skill_ids.len() > 1 {
            let mut sum: Option<(f64, f64)> = None;
            let mut proc = (0.0, 0.0);
            for (i, sid) in input.active_skill_ids.iter().enumerate() {
                let p =
                    compute_build_performance(&perf_deps(&input.perf, &inventory, Some(sid)));
                if let (Some(a), Some(b)) = (p.avg_hit_dps_min, p.avg_hit_dps_max) {
                    let s = sum.unwrap_or((0.0, 0.0));
                    sum = Some((s.0 + a, s.1 + b));
                }
                if i == 0 {
                    proc = (p.proc_dps_min, p.proc_dps_max);
                }
            }
            match sum {
                Some((a, b)) => (a + proc.0 + b + proc.1) / 2.0,
                None => (proc.0 + proc.1) / 2.0,
            }
        } else {
            let main = input
                .active_skill_ids
                .first()
                .map(String::as_str)
                .or(input.perf.main_skill_id.as_deref());
            let p = compute_build_performance(&perf_deps(&input.perf, &inventory, main));
            mid(p.combined_dps_min, p.combined_dps_max)
                .or_else(|| mid(p.hit_dps_min, p.hit_dps_max))
                .unwrap_or(0.0)
        };
        out.insert(base_id.clone(), dps);
    }
    out
}

// ---------- gear optimizer command ----------

const OPTIMIZER_SLOTS: [&str; 10] = [
    "weapon", "offhand", "helmet", "armor", "gloves", "boots", "belt", "amulet", "ring_1", "ring_2",
];
const OPTIMIZER_MAX_PASSES: usize = 4;
const OPTIMIZER_SET_SEEDS: usize = 12;
const OPTIMIZER_PAIR_WIDTH: usize = 8;
const OPTIMIZER_EPSILON: f64 = 1e-9;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeGearInput {
    pub perf: BuildPerformanceInput,
    pub selected_skill_id: String,
    #[serde(default)]
    pub thresholds: HashMap<String, f64>,
    #[serde(default)]
    pub rarity_filter: Option<GearRarityFilter>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GearRarityFilter {
    pub mode: String,
    pub rarity: String,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeGearResult {
    pub base_ids: HashMap<String, String>,
    pub before_score: f64,
    pub after_score: f64,
    pub evaluated: u64,
    pub passes: u32,
    pub thresholds_met: bool,
    pub threshold_values: HashMap<String, f64>,
    /// The catalog is far too large for a Cartesian proof. The command evaluates
    /// every base in repeated global-context sweeps, then refines pairs.
    pub exact: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GearOptimizerProgress {
    current: u64,
    total: u64,
}

fn bare_item(base_id: &str) -> EquippedItem {
    EquippedItem {
        base_id: base_id.to_string(),
        ..Default::default()
    }
}

fn bare_regular_inventory(source: &Inventory) -> Inventory {
    source
        .iter()
        .filter_map(|(slot, item)| {
            if crate::calc::data::is_gear_slot(slot)
                && crate::calc::data::get_item(&item.base_id).is_some()
            {
                Some((slot.clone(), bare_item(&item.base_id)))
            } else if !crate::calc::data::is_gear_slot(slot) {
                // Relics, charms and potions are fixed context in v1. They are
                // deliberately not searched, but their configured effects still
                // influence which regular item base is best.
                Some((slot.clone(), item.clone()))
            } else {
                None
            }
        })
        .collect()
}

#[cfg(test)]
fn optimizer_score(
    perf: &BuildPerformanceInput,
    inventory: &Inventory,
    selected_skill_id: &str,
) -> f64 {
    optimizer_evaluation(perf, inventory, selected_skill_id, &HashMap::new()).dps
}

#[derive(Clone, Copy, Debug, Default)]
struct GearEvaluation {
    dps: f64,
    max_normalized_deficit: f64,
    total_normalized_deficit: f64,
    thresholds_met: bool,
}

impl GearEvaluation {
    fn better_than(self, other: Self) -> bool {
        self.quality_cmp(other).is_gt()
    }

    /// Ordering by optimizer quality; greater means better.
    fn quality_cmp(self, other: Self) -> std::cmp::Ordering {
        if self.thresholds_met != other.thresholds_met {
            return self.thresholds_met.cmp(&other.thresholds_met);
        }
        if self.thresholds_met {
            return self.dps.total_cmp(&other.dps);
        }
        other
            .max_normalized_deficit
            .total_cmp(&self.max_normalized_deficit)
            .then_with(|| {
                other
                    .total_normalized_deficit
                    .total_cmp(&self.total_normalized_deficit)
            })
            .then_with(|| self.dps.total_cmp(&other.dps))
    }
}

fn threshold_id_supported(threshold_id: &str) -> bool {
    let Some((kind, key)) = threshold_id.split_once(':') else {
        return false;
    };
    if key.is_empty() || key.contains(':') {
        return false;
    }
    match kind {
        "attribute" => crate::calc::data::game_config()
            .attributes
            .iter()
            .any(|def| def.key == key),
        "stat" => crate::calc::data::game_config().stats.iter().any(|def| {
            def.key == key
                && !def.item_only.unwrap_or(false)
                && !def.skill_scoped.unwrap_or(false)
                && def.modifies_attribute.is_none()
        }),
        _ => false,
    }
}

#[derive(Clone, Debug)]
struct OptimizerThreshold {
    id: String,
    minimum: f64,
    supported: bool,
}

fn optimizer_thresholds(thresholds: &HashMap<String, f64>) -> Vec<OptimizerThreshold> {
    let mut out: Vec<OptimizerThreshold> = thresholds
        .iter()
        .map(|(id, minimum)| OptimizerThreshold {
            id: id.clone(),
            minimum: *minimum,
            supported: threshold_id_supported(id),
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn threshold_value(performance: &BuildPerformance, threshold_id: &str) -> f64 {
    let Some((kind, key)) = threshold_id.split_once(':') else {
        return 0.0;
    };
    let ranged = match kind {
        "attribute" => performance.attributes.get(key),
        "stat" => performance
            .stats_combined
            .get(key)
            .or_else(|| performance.stats.get(key)),
        _ => None,
    };
    ranged
        .copied()
        .map(|(a, b)| a.min(b))
        .filter(|value| value.is_finite())
        .unwrap_or(0.0)
}

/// A threshold is strict at user-visible precision, with a tiny relative
/// tolerance for floating-point accumulation. The normalized deficit is only
/// a cross-unit search guide; it must never decide whether a threshold is met.
fn threshold_status(value: f64, minimum: f64, supported: bool) -> (bool, f64) {
    if !supported || !value.is_finite() || !minimum.is_finite() {
        return (false, f64::MAX);
    }
    // Keep the relative guard bounded: an unbounded relative epsilon would
    // allow a material miss for a very large user-entered threshold.
    let tolerance = (OPTIMIZER_EPSILON * value.abs().max(minimum.abs()).max(1.0)).min(1e-6);
    if value + tolerance >= minimum {
        return (true, 0.0);
    }
    let normalized = (minimum - value) / minimum.abs().max(1.0);
    (false, normalized.max(0.0))
}

fn optimizer_performance(
    perf: &BuildPerformanceInput,
    inventory: &Inventory,
    selected_skill_id: &str,
) -> BuildPerformance {
    compute_build_performance(&perf_deps(perf, inventory, Some(selected_skill_id)))
}

#[cfg(test)]
fn optimizer_evaluation(
    perf: &BuildPerformanceInput,
    inventory: &Inventory,
    selected_skill_id: &str,
    thresholds: &HashMap<String, f64>,
) -> GearEvaluation {
    let thresholds = optimizer_thresholds(thresholds);
    optimizer_evaluation_with_thresholds(perf, inventory, selected_skill_id, &thresholds)
}

fn optimizer_evaluation_with_thresholds(
    perf: &BuildPerformanceInput,
    inventory: &Inventory,
    selected_skill_id: &str,
    thresholds: &[OptimizerThreshold],
) -> GearEvaluation {
    let p = optimizer_performance(perf, inventory, selected_skill_id);
    let midpoint = |min: Option<f64>, max: Option<f64>| match (min, max) {
        (Some(a), Some(b)) => (a + b) / 2.0,
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => 0.0,
    };
    let direct = midpoint(p.avg_hit_dps_min, p.avg_hit_dps_max);
    let ailment = midpoint(p.ailment_dps_min, p.ailment_dps_max);
    let score = (direct + ailment) * p.execute_mult;
    let dps = if score.is_finite() {
        score.max(0.0)
    } else {
        0.0
    };
    let mut max_normalized_deficit = 0.0_f64;
    let mut total_normalized_deficit = 0.0;
    let mut thresholds_met = true;
    for threshold in thresholds {
        let value = threshold_value(&p, &threshold.id);
        let (met, deficit) = threshold_status(value, threshold.minimum, threshold.supported);
        thresholds_met &= met;
        max_normalized_deficit = max_normalized_deficit.max(deficit);
        total_normalized_deficit = (total_normalized_deficit + deficit).min(f64::MAX);
    }
    GearEvaluation {
        dps,
        max_normalized_deficit,
        total_normalized_deficit,
        thresholds_met,
    }
}

fn optimizer_threshold_values(
    perf: &BuildPerformanceInput,
    inventory: &Inventory,
    selected_skill_id: &str,
    thresholds: &HashMap<String, f64>,
) -> HashMap<String, f64> {
    if thresholds.is_empty() {
        return HashMap::new();
    }
    let p = optimizer_performance(perf, inventory, selected_skill_id);
    thresholds
        .keys()
        .map(|id| (id.clone(), threshold_value(&p, id)))
        .collect()
}

fn slot_group(slot: &str) -> &str {
    slot.strip_suffix("_1")
        .or_else(|| slot.strip_suffix("_2"))
        .unwrap_or(slot)
}

fn rarity_rank(rarity: &str) -> Option<u8> {
    match rarity {
        "common" => Some(0),
        "uncommon" => Some(1),
        "rare" => Some(2),
        "mythic" => Some(3),
        "satanic" | "satanic_set" => Some(4),
        "heroic" => Some(5),
        "angelic" => Some(6),
        "unholy" => Some(7),
        _ => None,
    }
}

fn rarity_allowed(rarity: &str, filter: Option<&GearRarityFilter>) -> bool {
    let Some(filter) = filter else { return true };
    if filter.mode == "any" {
        return true;
    }
    let (Some(actual), Some(target)) = (rarity_rank(rarity), rarity_rank(&filter.rarity)) else {
        return false;
    };
    match filter.mode.as_str() {
        "exact" => actual == target,
        "at_least" => actual >= target,
        "at_most" => actual <= target,
        _ => false,
    }
}

fn optimizer_candidates(rarity_filter: Option<&GearRarityFilter>) -> HashMap<String, Vec<String>> {
    let mut out: HashMap<String, Vec<String>> = OPTIMIZER_SLOTS
        .iter()
        .map(|slot| ((*slot).to_string(), Vec::new()))
        .collect();
    for base in crate::calc::data::data().items.values() {
        if !rarity_allowed(&base.rarity, rarity_filter) {
            continue;
        }
        for slot in OPTIMIZER_SLOTS {
            let matches = if slot == "offhand" {
                base.slot == "offhand" || base.slot == "weapon"
            } else {
                slot_group(&base.slot) == slot_group(slot)
            };
            if matches {
                out.entry(slot.to_string())
                    .or_default()
                    .push(base.id.clone());
            }
        }
    }
    for ids in out.values_mut() {
        ids.sort();
        ids.dedup();
    }
    out
}

fn allocated_tree_has(input: &BuildPerformanceInput, patterns: &[&str]) -> bool {
    input.allocated_tree_nodes.iter().any(|id| {
        let Some(node) = crate::calc::data::get_tree_node(*id) else {
            return false;
        };
        let haystack = node.lines.join(" | ").to_lowercase();
        patterns.iter().all(|p| haystack.contains(p))
    })
}

fn has_hercules_grip(input: &BuildPerformanceInput) -> bool {
    allocated_tree_has(input, &["dual wield", "melee weapon"])
        || allocated_tree_has(input, &["dual wield", "swords", "maces", "axes"])
}

fn has_master_of_wands(input: &BuildPerformanceInput) -> bool {
    allocated_tree_has(input, &["dual wield", "wand"])
}

fn grip_type(base_type: &str) -> bool {
    matches!(base_type, "Sword" | "Mace" | "Axe" | "Polearm" | "Claw")
}

fn can_use_offhand(
    input: &BuildPerformanceInput,
    candidate_id: &str,
    mainhand_id: Option<&str>,
) -> bool {
    let Some(candidate) = crate::calc::data::get_item(candidate_id) else {
        return false;
    };
    let mainhand = mainhand_id.and_then(crate::calc::data::get_item);
    if mainhand.is_some_and(|base| base.two_handed == Some(true))
        || candidate.two_handed == Some(true)
    {
        if candidate.slot != "weapon" || !has_hercules_grip(input) {
            return false;
        }
        if mainhand.is_some_and(|base| !grip_type(&base.base_type)) {
            return false;
        }
        return grip_type(&candidate.base_type);
    }
    if candidate.slot == "offhand" {
        return true;
    }
    if candidate.slot != "weapon" {
        return false;
    }
    candidate.base_type != "Wand" || has_master_of_wands(input)
}

fn normalize_offhand(input: &BuildPerformanceInput, inventory: &mut Inventory) {
    let Some(offhand_id) = inventory.get("offhand").map(|i| i.base_id.clone()) else {
        return;
    };
    let mainhand_id = inventory.get("weapon").map(|i| i.base_id.as_str());
    if !can_use_offhand(input, &offhand_id, mainhand_id) {
        inventory.remove("offhand");
    }
}

fn base_signature(inventory: &Inventory) -> String {
    OPTIMIZER_SLOTS
        .iter()
        .map(|slot| {
            inventory
                .get(*slot)
                .map(|i| i.base_id.as_str())
                .unwrap_or("")
        })
        .collect::<Vec<_>>()
        .join("|")
}

fn retain_allowed_regular_items(
    inventory: &Inventory,
    rarity_filter: Option<&GearRarityFilter>,
) -> Inventory {
    inventory
        .iter()
        .filter_map(|(slot, item)| {
            if !crate::calc::data::is_gear_slot(slot) {
                return Some((slot.clone(), item.clone()));
            }
            let base = crate::calc::data::get_item(&item.base_id)?;
            rarity_allowed(&base.rarity, rarity_filter).then_some((slot.clone(), item.clone()))
        })
        .collect()
}

fn set_seed(
    fixed: &Inventory,
    item_ids: &[String],
    perf: &BuildPerformanceInput,
    rarity_filter: Option<&GearRarityFilter>,
) -> Inventory {
    let mut seed: Inventory = fixed
        .iter()
        .filter(|(slot, _)| !crate::calc::data::is_gear_slot(slot))
        .map(|(slot, item)| (slot.clone(), item.clone()))
        .collect();
    for item_id in item_ids {
        let Some(base) = crate::calc::data::get_item(item_id) else {
            continue;
        };
        if !crate::calc::data::is_gear_slot(&base.slot) {
            continue;
        }
        if !rarity_allowed(&base.rarity, rarity_filter) {
            continue;
        }
        let mut slot = base.slot.clone();
        if slot == "ring_1" && seed.contains_key("ring_1") {
            slot = "ring_2".to_string();
        }
        seed.insert(slot, bare_item(item_id));
    }
    normalize_offhand(perf, &mut seed);
    seed
}

fn compare_set_seeds(
    a: &(GearEvaluation, Inventory),
    b: &(GearEvaluation, Inventory),
) -> std::cmp::Ordering {
    b.0.quality_cmp(a.0)
        .then_with(|| base_signature(&a.1).cmp(&base_signature(&b.1)))
}

fn join_optimizer_result<E: std::fmt::Display>(
    result: Result<OptimizeGearResult, E>,
) -> Result<OptimizeGearResult, String> {
    result.map_err(|error| format!("gear optimizer task failed: {error}"))
}

struct GearSearch<'a, F: FnMut(u64, u64)> {
    perf: &'a BuildPerformanceInput,
    selected_skill_id: &'a str,
    evaluated: u64,
    total_hint: u64,
    thresholds: &'a [OptimizerThreshold],
    cache: HashMap<String, GearEvaluation>,
    on_progress: F,
}

impl<'a, F: FnMut(u64, u64)> GearSearch<'a, F> {
    fn evaluate(&mut self, inventory: &Inventory) -> GearEvaluation {
        let signature = base_signature(inventory);
        if let Some(evaluation) = self.cache.get(&signature) {
            return *evaluation;
        }
        let evaluation = optimizer_evaluation_with_thresholds(
            self.perf,
            inventory,
            self.selected_skill_id,
            self.thresholds,
        );
        self.cache.insert(signature, evaluation);
        self.evaluated += 1;
        if self.evaluated == 1 || self.evaluated % 128 == 0 {
            (self.on_progress)(self.evaluated, self.total_hint);
        }
        evaluation
    }

    fn best_for_slot(
        &mut self,
        inventory: &Inventory,
        current_evaluation: GearEvaluation,
        slot: &str,
        ids: &[String],
    ) -> (Inventory, GearEvaluation, Vec<(String, GearEvaluation)>) {
        let mut best_inventory = inventory.clone();
        let mut best_evaluation = current_evaluation;
        let mut alternatives: Vec<(String, GearEvaluation)> = Vec::with_capacity(ids.len());

        let mut empty = inventory.clone();
        empty.remove(slot);
        if slot == "weapon" {
            normalize_offhand(self.perf, &mut empty);
        }
        let empty_evaluation = self.evaluate(&empty);
        if empty_evaluation.better_than(best_evaluation) {
            best_evaluation = empty_evaluation;
            best_inventory = empty;
        }

        for id in ids {
            if slot == "offhand" {
                let mainhand_id = inventory.get("weapon").map(|i| i.base_id.as_str());
                if !can_use_offhand(self.perf, id, mainhand_id) {
                    continue;
                }
            }
            let mut candidate = inventory.clone();
            candidate.insert(slot.to_string(), bare_item(id));
            if slot == "weapon" {
                normalize_offhand(self.perf, &mut candidate);
            }
            let evaluation = self.evaluate(&candidate);
            alternatives.push((id.clone(), evaluation));
            if evaluation.better_than(best_evaluation) {
                best_evaluation = evaluation;
                best_inventory = candidate;
            }
        }
        alternatives.sort_by(|a, b| b.1.quality_cmp(a.1).then_with(|| a.0.cmp(&b.0)));
        alternatives.truncate(OPTIMIZER_PAIR_WIDTH);
        (best_inventory, best_evaluation, alternatives)
    }

    fn coordinate(
        &mut self,
        mut inventory: Inventory,
        candidates: &HashMap<String, Vec<String>>,
    ) -> (Inventory, GearEvaluation, u32) {
        normalize_offhand(self.perf, &mut inventory);
        let mut evaluation = self.evaluate(&inventory);
        let mut passes = 0;
        for _ in 0..OPTIMIZER_MAX_PASSES {
            passes += 1;
            let before = base_signature(&inventory);
            for slot in OPTIMIZER_SLOTS {
                let ids = candidates.get(slot).map(Vec::as_slice).unwrap_or(&[]);
                let (next, next_evaluation, _) =
                    self.best_for_slot(&inventory, evaluation, slot, ids);
                inventory = next;
                evaluation = next_evaluation;
            }
            if base_signature(&inventory) == before {
                break;
            }
        }
        (inventory, evaluation, passes)
    }

    fn refine_pairs(
        &mut self,
        mut inventory: Inventory,
        mut evaluation: GearEvaluation,
        candidates: &HashMap<String, Vec<String>>,
    ) -> (Inventory, GearEvaluation) {
        let mut top_by_slot: HashMap<&str, Vec<String>> = HashMap::new();
        for slot in OPTIMIZER_SLOTS {
            let ids = candidates.get(slot).map(Vec::as_slice).unwrap_or(&[]);
            let (_, _, alternatives) = self.best_for_slot(&inventory, evaluation, slot, ids);
            top_by_slot.insert(slot, alternatives.into_iter().map(|(id, _)| id).collect());
        }
        for (left, &a_slot) in OPTIMIZER_SLOTS.iter().enumerate() {
            for &b_slot in OPTIMIZER_SLOTS.iter().skip(left + 1) {
                let Some(a_ids) = top_by_slot.get(a_slot) else {
                    continue;
                };
                let Some(b_ids) = top_by_slot.get(b_slot) else {
                    continue;
                };
                for a_id in a_ids {
                    for b_id in b_ids {
                        let mut candidate = inventory.clone();
                        candidate.insert(a_slot.to_string(), bare_item(a_id));
                        if a_slot == "weapon" {
                            normalize_offhand(self.perf, &mut candidate);
                        }
                        if b_slot == "offhand" {
                            let main = candidate.get("weapon").map(|i| i.base_id.as_str());
                            if !can_use_offhand(self.perf, b_id, main) {
                                continue;
                            }
                        }
                        candidate.insert(b_slot.to_string(), bare_item(b_id));
                        if b_slot == "weapon" {
                            normalize_offhand(self.perf, &mut candidate);
                        }
                        let candidate_evaluation = self.evaluate(&candidate);
                        if candidate_evaluation.better_than(evaluation) {
                            inventory = candidate;
                            evaluation = candidate_evaluation;
                        }
                    }
                }
            }
        }
        (inventory, evaluation)
    }
}

fn optimize_gear_impl<F: FnMut(u64, u64)>(
    input: &OptimizeGearInput,
    on_progress: F,
) -> OptimizeGearResult {
    if input.selected_skill_id.trim().is_empty() {
        return OptimizeGearResult::default();
    }
    // `before_score` describes the user's current regular bases even when the
    // requested rarity filter excludes one of them. Search seeds and results,
    // however, must never retain an excluded regular item unchanged.
    let unfiltered_current = bare_regular_inventory(&input.perf.inventory);
    let mut current =
        retain_allowed_regular_items(&unfiltered_current, input.rarity_filter.as_ref());
    normalize_offhand(&input.perf, &mut current);
    let candidates = optimizer_candidates(input.rarity_filter.as_ref());
    let candidate_count: u64 = candidates.values().map(|ids| ids.len() as u64 + 1).sum();
    let set_count = crate::calc::data::data().sets.len() as u64;
    let total_hint = set_count
        + (OPTIMIZER_SET_SEEDS as u64 + 2) * OPTIMIZER_MAX_PASSES as u64 * candidate_count
        + candidate_count
        + (OPTIMIZER_SLOTS.len() * OPTIMIZER_SLOTS.len() * OPTIMIZER_PAIR_WIDTH.pow(2)) as u64;
    let thresholds = optimizer_thresholds(&input.thresholds);
    let mut search = GearSearch {
        perf: &input.perf,
        selected_skill_id: &input.selected_skill_id,
        evaluated: 0,
        total_hint,
        thresholds: &thresholds,
        cache: HashMap::new(),
        on_progress,
    };

    let before_evaluation = search.evaluate(&unfiltered_current);
    let current_evaluation = search.evaluate(&current);
    let fixed: Inventory = unfiltered_current
        .iter()
        .filter(|(slot, _)| !crate::calc::data::is_gear_slot(slot))
        .map(|(slot, item)| (slot.clone(), item.clone()))
        .collect();
    let mut seeds = vec![current.clone(), fixed.clone()];
    let mut set_seeds: Vec<(GearEvaluation, Inventory)> = crate::calc::data::data()
        .sets
        .values()
        .map(|set| {
            let ids: Vec<String> = set
                .items
                .iter()
                .map(|piece| piece.item_id.clone())
                .collect();
            let seed = set_seed(&fixed, &ids, &input.perf, input.rarity_filter.as_ref());
            (search.evaluate(&seed), seed)
        })
        .collect();
    set_seeds.sort_by(compare_set_seeds);
    seeds.extend(
        set_seeds
            .into_iter()
            .take(OPTIMIZER_SET_SEEDS)
            .map(|(_, seed)| seed),
    );
    let mut seen = HashSet::new();
    seeds.retain(|seed| seen.insert(base_signature(seed)));

    let mut best_inventory = current;
    let mut best_evaluation = current_evaluation;
    let mut total_passes = 0;
    for seed in seeds {
        let (candidate, evaluation, passes) = search.coordinate(seed, &candidates);
        total_passes += passes;
        if evaluation.better_than(best_evaluation) {
            best_inventory = candidate;
            best_evaluation = evaluation;
        }
    }
    let (refined, _) = search.refine_pairs(best_inventory, best_evaluation, &candidates);
    let (best_inventory, best_evaluation, extra_passes) = search.coordinate(refined, &candidates);
    total_passes += extra_passes;

    (search.on_progress)(search.evaluated, search.evaluated);
    let base_ids = OPTIMIZER_SLOTS
        .iter()
        .filter_map(|slot| {
            best_inventory
                .get(*slot)
                .map(|item| ((*slot).to_string(), item.base_id.clone()))
        })
        .collect();
    let threshold_values = optimizer_threshold_values(
        &input.perf,
        &best_inventory,
        &input.selected_skill_id,
        &input.thresholds,
    );
    OptimizeGearResult {
        base_ids,
        before_score: before_evaluation.dps,
        after_score: best_evaluation.dps,
        evaluated: search.evaluated,
        passes: total_passes,
        thresholds_met: best_evaluation.thresholds_met,
        threshold_values,
        exact: false,
    }
}

#[tauri::command]
pub async fn optimize_gear(
    app: tauri::AppHandle,
    input: OptimizeGearInput,
) -> Result<OptimizeGearResult, String> {
    let season = input.perf.season.clone();
    join_optimizer_result(
        tauri::async_runtime::spawn_blocking(move || {
            let _scope = crate::calc::season::SeasonScope::enter(season);
            optimize_gear_impl(&input, |current, total| {
                let _ = app.emit(
                    "gear-optimizer-progress",
                    GearOptimizerProgress { current, total },
                );
            })
        })
        .await,
    )
}

#[cfg(test)]
mod gear_optimizer_tests {
    use super::*;

    fn empty_perf() -> BuildPerformanceInput {
        serde_json::from_str("{}").expect("all fields default")
    }

    #[test]
    fn spell_objective_is_finite_for_a_real_allocated_spell() {
        let perf: BuildPerformanceInput = serde_json::from_value(serde_json::json!({
            "classId": "jotunn",
            "level": 100,
            "skillRanks": { "orb_of_frost": 20 },
            "enemyResistances": { "cold": 0 }
        }))
        .expect("valid optimizer fixture");
        let score = optimizer_score(&perf, &Inventory::new(), "orb_of_frost");
        assert!(score.is_finite() && score > 0.0, "score was {score}");
    }

    #[test]
    fn regular_items_are_bared_while_special_items_stay_fixed() {
        let weapon_id = crate::calc::data::data()
            .items
            .values()
            .find(|item| item.slot == "weapon")
            .map(|item| item.id.clone())
            .expect("weapon fixture");
        let charm_id = crate::calc::data::data()
            .items
            .values()
            .find(|item| item.slot.starts_with("charm_"))
            .map(|item| item.id.clone())
            .expect("charm fixture");
        let mut inventory = Inventory::new();
        inventory.insert(
            "weapon".to_string(),
            EquippedItem {
                base_id: weapon_id,
                stars: Some(5),
                ..Default::default()
            },
        );
        inventory.insert(
            "charm_1".to_string(),
            EquippedItem {
                base_id: charm_id,
                stars: Some(5),
                ..Default::default()
            },
        );

        let out = bare_regular_inventory(&inventory);
        assert_eq!(out["weapon"].stars, None);
        assert_eq!(out["charm_1"].stars, Some(5));
    }

    #[test]
    fn ordinary_two_handed_weapon_clears_the_offhand() {
        let weapon_id = crate::calc::data::data()
            .items
            .values()
            .find(|item| item.slot == "weapon" && item.two_handed == Some(true))
            .map(|item| item.id.clone())
            .expect("two-handed fixture");
        let offhand_id = crate::calc::data::data()
            .items
            .values()
            .find(|item| item.slot == "offhand")
            .map(|item| item.id.clone())
            .expect("offhand fixture");
        let mut inventory = Inventory::from([
            ("weapon".to_string(), bare_item(&weapon_id)),
            ("offhand".to_string(), bare_item(&offhand_id)),
        ]);
        normalize_offhand(&empty_perf(), &mut inventory);
        assert!(!inventory.contains_key("offhand"));
    }

    #[test]
    fn book_of_cold_death_can_dual_wield_glacier_talons() {
        let book = "book_heroic_book_of_cold_death";
        let talons = "claw_heroic_glacier_talons";
        assert_ne!(
            crate::calc::data::get_item(book).and_then(|item| item.two_handed),
            Some(true)
        );
        assert_ne!(
            crate::calc::data::get_item(talons).and_then(|item| item.two_handed),
            Some(true)
        );
        assert!(can_use_offhand(&empty_perf(), talons, Some(book)));
    }

    #[test]
    fn threshold_values_are_namespaced_combined_and_conservative() {
        let mut performance = optimizer_performance(&empty_perf(), &Inventory::new(), "");
        performance
            .attributes
            .insert("strength".to_string(), (80.0, 120.0));
        performance.stats.insert("life".to_string(), (100.0, 200.0));
        performance
            .stats_combined
            .insert("life".to_string(), (130.0, 170.0));
        performance
            .stats
            .insert("fire_resistance".to_string(), (100.0, 80.0));

        assert_eq!(threshold_value(&performance, "attribute:strength"), 80.0);
        assert_eq!(threshold_value(&performance, "stat:life"), 130.0);
        assert_eq!(threshold_value(&performance, "stat:fire_resistance"), 80.0);
        assert_eq!(threshold_value(&performance, "stat:block_chance"), 0.0);
        assert!(threshold_id_supported("attribute:armor"));
        assert!(threshold_id_supported("stat:life"));
        assert!(!threshold_id_supported("stat:to_strength"));
        assert!(!threshold_id_supported("derived:effective_hp"));
    }

    #[test]
    fn threshold_status_uses_a_bounded_numeric_tolerance() {
        let (met, deficit) = threshold_status(74.0, 75.0, true);
        assert!(!met);
        assert!((deficit - 1.0 / 75.0).abs() < 1e-12);

        assert!(threshold_status(75.0 - 1e-9, 75.0, true).0);
        assert!(!threshold_status(1e15 - 1.0, 1e15, true).0);
        assert!(!threshold_status(75.0, 75.0, false).0);
        assert!(!threshold_status(75.0, f64::NAN, true).0);
    }

    #[test]
    fn constraint_quality_is_lexicographic_and_deterministic() {
        let feasible_low_dps = GearEvaluation {
            dps: 10.0,
            max_normalized_deficit: 0.0,
            total_normalized_deficit: 0.0,
            thresholds_met: true,
        };
        let feasible_high_dps = GearEvaluation {
            dps: 20.0,
            ..feasible_low_dps
        };
        let infeasible_high_dps = GearEvaluation {
            dps: 1_000.0,
            max_normalized_deficit: 0.2,
            total_normalized_deficit: 0.2,
            thresholds_met: false,
        };
        let infeasible_closer = GearEvaluation {
            dps: 1.0,
            max_normalized_deficit: 0.1,
            total_normalized_deficit: 0.1,
            thresholds_met: false,
        };

        assert!(feasible_low_dps.better_than(infeasible_high_dps));
        assert!(feasible_high_dps.better_than(feasible_low_dps));
        assert!(infeasible_closer.better_than(infeasible_high_dps));
        assert!(GearEvaluation {
            dps: 2.0,
            ..infeasible_closer
        }
        .better_than(infeasible_closer));
        let uneven = GearEvaluation {
            dps: 100.0,
            max_normalized_deficit: 0.4,
            total_normalized_deficit: 0.4,
            thresholds_met: false,
        };
        let balanced = GearEvaluation {
            dps: 1.0,
            max_normalized_deficit: 0.3,
            total_normalized_deficit: 0.6,
            thresholds_met: false,
        };
        assert!(balanced.better_than(uneven));
        assert_eq!(
            feasible_low_dps.quality_cmp(feasible_low_dps),
            std::cmp::Ordering::Equal
        );
    }

    #[test]
    fn equal_set_seeds_are_sorted_by_signature() {
        let evaluation = GearEvaluation {
            dps: 100.0,
            thresholds_met: true,
            ..Default::default()
        };
        let a = Inventory::from([("weapon".to_string(), bare_item("a_weapon"))]);
        let b = Inventory::from([("weapon".to_string(), bare_item("b_weapon"))]);
        let mut seeds = vec![(evaluation, b), (evaluation, a)];

        seeds.sort_by(compare_set_seeds);

        assert_eq!(base_signature(&seeds[0].1), "a_weapon|||||||||");
        assert_eq!(base_signature(&seeds[1].1), "b_weapon|||||||||");
    }

    #[test]
    fn panicked_optimizer_task_is_a_command_error_not_an_empty_success() {
        let result = tauri::async_runtime::block_on(async {
            let task = tauri::async_runtime::spawn_blocking(|| -> OptimizeGearResult {
                panic!("optimizer test panic")
            });
            join_optimizer_result(task.await)
        });
        let error = result.err().expect("panic must become a command error");
        assert!(error.starts_with("gear optimizer task failed:"), "{error}");
        assert!(error.contains("optimizer test panic"), "{error}");
    }

    #[test]
    fn ranged_minimum_must_be_guaranteed_not_merely_possible() {
        let perf: BuildPerformanceInput = serde_json::from_value(serde_json::json!({
            "customStats": [{ "statKey": "fire_resistance", "value": "74-80" }]
        }))
        .expect("valid ranged threshold fixture");
        let thresholds = HashMap::from([("stat:fire_resistance".to_string(), 75.0)]);
        let evaluation = optimizer_evaluation(&perf, &Inventory::new(), "", &thresholds);
        assert!(!evaluation.thresholds_met);
        assert!(evaluation.max_normalized_deficit > 0.0);
        assert!(evaluation.total_normalized_deficit > 0.0);
    }

    #[test]
    fn rarity_filter_orders_tiers_and_treats_sets_as_satanic() {
        let exact_satanic = GearRarityFilter {
            mode: "exact".to_string(),
            rarity: "satanic".to_string(),
        };
        assert!(rarity_allowed("satanic", Some(&exact_satanic)));
        assert!(rarity_allowed("satanic_set", Some(&exact_satanic)));
        assert!(!rarity_allowed("heroic", Some(&exact_satanic)));

        let at_least_heroic = GearRarityFilter {
            mode: "at_least".to_string(),
            rarity: "heroic".to_string(),
        };
        assert!(!rarity_allowed("satanic", Some(&at_least_heroic)));
        assert!(rarity_allowed("heroic", Some(&at_least_heroic)));
        assert!(rarity_allowed("angelic", Some(&at_least_heroic)));
        assert!(rarity_allowed("unholy", Some(&at_least_heroic)));

        let at_most_mythic = GearRarityFilter {
            mode: "at_most".to_string(),
            rarity: "mythic".to_string(),
        };
        assert!(rarity_allowed("common", Some(&at_most_mythic)));
        assert!(rarity_allowed("mythic", Some(&at_most_mythic)));
        assert!(!rarity_allowed("satanic", Some(&at_most_mythic)));
    }

    #[test]
    fn filtered_candidate_catalog_contains_no_disallowed_rarity() {
        let exact_satanic = GearRarityFilter {
            mode: "exact".to_string(),
            rarity: "satanic".to_string(),
        };
        let candidates = optimizer_candidates(Some(&exact_satanic));
        let ids: Vec<&String> = candidates.values().flatten().collect();
        assert!(!ids.is_empty());
        assert!(ids.iter().all(|id| {
            crate::calc::data::get_item(id)
                .is_some_and(|base| matches!(base.rarity.as_str(), "satanic" | "satanic_set"))
        }));
        assert!(ids.iter().any(|id| {
            crate::calc::data::get_item(id).is_some_and(|base| base.rarity == "satanic_set")
        }));
    }

    #[test]
    fn rarity_filter_drops_disallowed_regular_gear_but_keeps_fixed_specials() {
        let regular = crate::calc::data::data()
            .items
            .values()
            .find(|item| crate::calc::data::is_gear_slot(&item.slot) && item.rarity != "heroic")
            .expect("non-heroic regular fixture");
        let special = crate::calc::data::data()
            .items
            .values()
            .find(|item| !crate::calc::data::is_gear_slot(&item.slot))
            .expect("fixed special fixture");
        let inventory = Inventory::from([
            (regular.slot.clone(), bare_item(&regular.id)),
            (special.slot.clone(), bare_item(&special.id)),
        ]);
        let filter = GearRarityFilter {
            mode: "exact".to_string(),
            rarity: "heroic".to_string(),
        };

        let retained = retain_allowed_regular_items(&inventory, Some(&filter));
        assert!(!retained.contains_key(&regular.slot));
        assert_eq!(retained[&special.slot].base_id, special.id);
    }

    #[test]
    fn candidate_catalog_is_deterministic_and_covers_every_regular_slot() {
        let candidates = optimizer_candidates(None);
        for slot in OPTIMIZER_SLOTS {
            let ids = candidates.get(slot).expect("slot candidate list");
            assert!(!ids.is_empty(), "{slot} had no candidates");
            assert!(ids.windows(2).all(|pair| pair[0] < pair[1]));
        }
    }

    #[test]
    #[ignore = "full patched-season catalog search; run explicitly as an integration smoke test"]
    fn full_catalog_optimizer_smoke() {
        let perf: BuildPerformanceInput = serde_json::from_value(serde_json::json!({
            "classId": "jotunn",
            "level": 100,
            "allocatedAttrs": { "intelligence": 100 },
            "skillRanks": {
                "orb_of_frost": 20,
                "icicles": 20,
                "power_of_the_ancients": 20,
                "blizzard": 20
            },
            "enemyResistances": { "cold": 0 }
        }))
        .expect("valid optimizer fixture");
        let result = optimize_gear_impl(
            &OptimizeGearInput {
                perf,
                selected_skill_id: "orb_of_frost".to_string(),
                thresholds: HashMap::new(),
                rarity_filter: None,
            },
            |_, _| {},
        );
        assert!(result.after_score >= result.before_score);
        assert!(result.evaluated > 1_000);
        assert!(!result.base_ids.is_empty());
        eprintln!(
            "optimizer smoke: {} evaluations, {} passes, {} -> {}",
            result.evaluated, result.passes, result.before_score, result.after_score
        );
    }
}

/// Warm-up progress: `current` of `total` tree nodes parsed. Emitted as
/// "warmup-progress" so the boot splash can drive an honest 0–15% slice.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WarmupProgress {
    current: u32,
    total: u32,
}

/// Warms the data Lazy and parser caches so the first real calc isn't stuck
/// compiling ~300 regexes on the UI thread. IO-free so tests can drive it.
pub fn run_warmup<F: FnMut(u32, u32)>(mut on_progress: F) -> bool {
    let d = crate::calc::data::data();
    if d.items.is_empty() {
        return false;
    }
    let nodes = crate::calc::data::tree_nodes();
    let total = nodes.len() as u32;
    // Cap emitted ticks so a ~1000-node warm-up doesn't flood the event channel.
    let step = (nodes.len() / 20).max(1);
    for (i, node) in nodes.values().enumerate() {
        for line in &node.lines {
            let _ = crate::calc::tree::parse::parse_tree_node_mod(line);
            let _ = crate::calc::tree::parse::parse_tree_node_meta(line);
        }
        if i % step == 0 {
            on_progress(i as u32, total);
        }
    }
    on_progress(total, total);
    true
}

/// Tauri command: runs the warm-up off the event loop so the webview stays
/// responsive, emitting "warmup-progress" for the boot splash.
#[tauri::command]
pub async fn calc_warmup(app: tauri::AppHandle, season: Option<String>) -> bool {
    // Scope lives inside the blocking closure so it never crosses an .await.
    tauri::async_runtime::spawn_blocking(move || {
        let _scope = crate::calc::season::SeasonScope::enter(season);
        run_warmup(|current, total| {
            let _ = app.emit("warmup-progress", WarmupProgress { current, total });
        })
    })
    .await
    .unwrap_or(false)
}

/// Returns full stats plus per-stat source breakdown rendered by StatsView and
/// the tooltips. Reuses `BuildPerformanceInput`; damage/proc fields are unused here.
#[tauri::command]
pub fn calc_build_stats(input: BuildPerformanceInput) -> ComputedStats {
    let _scope = crate::calc::season::SeasonScope::enter(input.season.clone());
    let stats_input = BuildStatsInput {
        class_id: input.class_id.as_deref(),
        level: input.level,
        allocated_attrs: &input.allocated_attrs,
        inventory: &input.inventory,
        skill_ranks: &input.skill_ranks,
        active_aura_id: input.active_aura_id.as_deref(),
        active_buffs: &input.active_buffs,
        custom_stats: &input.custom_stats,
        allocated_tree_nodes: &input.allocated_tree_nodes,
        tree_socketed: &input.tree_socketed,
        player_conditions: &input.player_conditions,
        subskill_ranks: &input.subskill_ranks,
        enemy_conditions: &input.enemy_conditions,
        granted_skill_ranks: Some(&input.granted_skill_ranks),
        main_skill_id: input.main_skill_id.as_deref(),
    };
    compute_build_stats(&stats_input)
}

/// Backs StatBreakdownModal: re-runs stats and slices out one key's additive/more
/// contributions, subtotals and final value. `kind` picks stat vs attribute sources.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatBreakdownInput {
    #[serde(flatten)]
    pub deps: BuildPerformanceInput,
    pub stat_key: String,
    #[serde(default)]
    pub kind: StatBreakdownKind,
}

#[derive(Deserialize, Default, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum StatBreakdownKind {
    #[default]
    Stat,
    Attribute,
}

#[tauri::command]
pub fn calc_stat_breakdown(input: StatBreakdownInput) -> StatBreakdown {
    let _scope = crate::calc::season::SeasonScope::enter(input.deps.season.clone());
    let stats_input = BuildStatsInput {
        class_id: input.deps.class_id.as_deref(),
        level: input.deps.level,
        allocated_attrs: &input.deps.allocated_attrs,
        inventory: &input.deps.inventory,
        skill_ranks: &input.deps.skill_ranks,
        active_aura_id: input.deps.active_aura_id.as_deref(),
        active_buffs: &input.deps.active_buffs,
        custom_stats: &input.deps.custom_stats,
        allocated_tree_nodes: &input.deps.allocated_tree_nodes,
        tree_socketed: &input.deps.tree_socketed,
        player_conditions: &input.deps.player_conditions,
        subskill_ranks: &input.deps.subskill_ranks,
        enemy_conditions: &input.deps.enemy_conditions,
        granted_skill_ranks: Some(&input.deps.granted_skill_ranks),
        main_skill_id: input.deps.main_skill_id.as_deref(),
    };
    let computed = compute_build_stats(&stats_input);
    let sources = match input.kind {
        StatBreakdownKind::Stat => &computed.stat_sources,
        StatBreakdownKind::Attribute => &computed.attribute_sources,
    };
    let final_value = match input.kind {
        StatBreakdownKind::Stat => computed.stats.get(&input.stat_key).copied(),
        StatBreakdownKind::Attribute => computed.attributes.get(&input.stat_key).copied(),
    };
    compute_stat_breakdown(sources, &input.stat_key, final_value)
}
