import { useMemo } from 'react'
import { useBuild } from '../../store/build'
import { getClass } from '@data'
import {
  getActiveProfile,
  listSavedBuilds,
  type Folder,
  type SavedBuild,
} from '../../utils/build/savedBuilds'
import { listFolders } from '../../utils/build/savedFolders'
import { heroLevelFor } from '../../utils/build/heroLevel'
import { decodeShareToBuild } from '../../utils/build/shareBuild'
import { pruneUnknownAllocationIds } from '../../utils/build/seasonMigration'
import { activeSeasonId } from '@data'

export interface BuildMeta {
  level: number
  heroLevel: number
  nodes: number
  className: string
  decoded: boolean
}

export interface BuildLibrary {
  builds: SavedBuild[]
  folders: Folder[]
  meta: Record<string, BuildMeta>
  childFolders: Record<string, Folder[]>
}

export function useBuildLibrary(): BuildLibrary {
  const version = useBuild((s) => s.savedBuildsVersion)

  return useMemo<BuildLibrary>(() => {
    void version
    const builds = listSavedBuilds()
    const folders = listFolders()

    const meta: Record<string, BuildMeta> = {}
    for (const b of builds) {
      const profile = getActiveProfile(b)
      const cls = b.classId ? getClass(b.classId) : undefined
      let level = 1
      let heroLevel = 0
      let nodes = 0
      let decoded = false
      if (profile) {
        const share = decodeShareToBuild(profile.code)
        if (share) {
          const snapshot =
            b.season === activeSeasonId
              ? pruneUnknownAllocationIds(share.snapshot)
              : share.snapshot
          level = snapshot.level
          heroLevel = heroLevelFor(snapshot)
          nodes = snapshot.allocatedTreeNodes.size
          decoded = true
        }
      }
      meta[b.id] = {
        level,
        heroLevel,
        nodes,
        className: cls?.name ?? 'Unknown',
        decoded,
      }
    }

    const childFolders: Record<string, Folder[]> = {}
    for (const f of folders) {
      const key = f.parentId ?? ''
      ;(childFolders[key] ??= []).push(f)
    }
    for (const key of Object.keys(childFolders)) {
      childFolders[key]!.sort((a, b) => a.name.localeCompare(b.name))
    }

    return { builds, folders, meta, childFolders }
  }, [version])
}
