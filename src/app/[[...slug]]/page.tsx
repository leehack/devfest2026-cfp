import { ClientApp } from './ClientApp';

/**
 * Every route, served through the app's own client-side router.
 *
 * A server component only so it can read the path Next matched and hand it
 * down: the client router would otherwise read `window` on its first render and
 * disagree with HTML rendered without one. Everything below this is a client
 * component, because everything below it needs an authenticated Firebase SDK.
 *
 * The public pages get real server rendering as their own segments, which take
 * precedence over this catch-all.
 */
export default async function CatchAll({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  return <ClientApp initialPath={`/${(slug ?? []).join('/')}`} />;
}
