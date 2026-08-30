pub mod calc;
mod suggest_engine;

#[cfg(any(windows, target_os = "linux"))]
use tauri::Manager;
#[cfg(any(windows, target_os = "linux"))]
use tauri_plugin_deep_link::DeepLinkExt;

#[tauri::command]
fn dev_import_token() -> Result<String, String> {
  if !cfg!(debug_assertions) {
    return Err("build import is available only in debug builds".to_string());
  }

  let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
  let home = std::env::var_os(home_var)
    .ok_or_else(|| format!("{home_var} is not set"))?;
  let path = std::path::PathBuf::from(home)
    .join(".hsplanner")
    .join("dev-import-5173.token");
  let token = std::fs::read_to_string(path)
    .map_err(|err| format!("could not read the dev import token: {err}"))?;
  let token = token.trim();
  if token.is_empty() {
    return Err("dev import token is empty".to_string());
  }
  Ok(token.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default();

  #[cfg(any(windows, target_os = "linux"))]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
    if let Some(window) = app.get_webview_window("main") {
      let _ = window.set_focus();
    }
  }));

  builder
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      #[cfg(any(windows, target_os = "linux"))]
      if let Err(e) = app.deep_link().register("hsp") {
        log::warn!("failed to register hsp:// deep link scheme: {e}");
      }

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      dev_import_token,
      calc::commands::compute_skill_damage,
      calc::commands::compute_attack_skill_damage,
      calc::commands::compute_weapon_damage,
      calc::commands::calc_build_performance,
      calc::commands::rank_slot_items,
      calc::commands::optimize_gear,
      calc::commands::calc_build_stats,
      calc::commands::calc_stat_breakdown,
      calc::commands::calc_warmup,
      calc::commands::passive_stats_at_rank,
      calc::commands::mana_cost_at_rank,
      calc::commands::subskill_aggregation,
      calc::commands::classify_tree_nodes,
      calc::commands::display_values,
      calc::commands::parse_custom_stats,
      suggest_engine::command::suggest_tree_nodes,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
