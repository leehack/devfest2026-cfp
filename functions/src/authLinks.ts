/**
 * Moves a generated Firebase action link onto the project's equivalent Hosting
 * origin. The Admin SDK rejects a default web.app domain in `linkDomain`, but
 * the two default domains serve the same reserved auth handler and action code.
 */
export function useFreshHostingOrigin(
  link: string,
  projectId: string | undefined,
  emulator: boolean,
): string {
  if (!projectId || emulator) return link;

  const url = new URL(link);
  if (url.hostname !== `${projectId}.firebaseapp.com`) return link;
  url.hostname = `${projectId}.web.app`;
  return url.toString();
}
