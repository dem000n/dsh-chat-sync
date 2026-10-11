/**
 * Read-only access to the stored workspace registry document.
 *
 * The registry is deliberately never written from here. The running Harness
 * keeps it in memory and rewrites the whole document on every change, so an
 * external edit is lost at the next write; and its loader rejects a document
 * whose invariants are broken — a workspace repeated in the id list, the same
 * folder twice, or one chat counted under two workspaces. Writing it is
 * therefore the running registry service's job (`ctx.workspaceRegistry`),
 * and this module only exists as a fallback for reading folder paths when that
 * service is unavailable.
 * @module @local/dsh-sync/host/workspace-file
 */

/**
 * Every folder path a stored registry names.
 * @param registry - a parsed `workspace.json`, or anything else.
 * @returns absolute folder paths, ignoring anything malformed.
 */
export function workspacePaths(registry) {
  const workspaces = registry?.tables?.workspaces;
  if (typeof workspaces !== 'object' || workspaces === null) return [];
  const paths = [];
  for (const workspace of Object.values(workspaces)) {
    if (typeof workspace?.path === 'string' && workspace.path !== '') paths.push(workspace.path);
  }
  return paths;
}
