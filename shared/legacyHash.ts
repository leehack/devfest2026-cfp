/**
 * The source of a script that turns a `#/c/{id}` URL into its path equivalent,
 * before anything renders.
 *
 * Those links are in people's mailboxes — every acceptance, every sign-in link
 * sent before the move to paths — and a mailed link is not something we get to
 * reissue. A fragment is never sent to a server, so no amount of rendering on
 * one can fix this: it has to happen in the browser, and it has to happen before
 * the first paint or the visitor watches the wrong page appear and leave.
 *
 * So it ships as a blocking inline `<script>` in `<head>` rather than as an
 * effect. It is a string rather than a module because a module would be fetched,
 * and anything fetched arrives too late.
 *
 * Two details carried over verbatim from the router it replaces:
 *   - `#/c/{id}` means the *form*, not the CFP front page. That is what it meant
 *     when those links were written — the front page did not exist — and an
 *     acceptance saying "confirm your talk here" should still land on the talk.
 *   - the query string survives, because a sign-in link's one-time code is in it.
 */
export function legacyHashScript(): string {
  return `(function(){try{
var h=location.hash;
if(h.indexOf('#/')!==0)return;
if(location.pathname!=='/')return;
var p=h.slice(1).replace(/^\\/+|\\/+$/g,'').split('/');
var t='/';
if(p[0]==='new'||p[0]==='me'){t='/'+p[0];}
else if(p[0]==='c'&&p[1]&&/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p[1])){
var s=p[2];
t=s==='admin'?('/c/'+p[1]+'/admin'+(p[3]?'/'+p[3]:'')):s==='review'?('/c/'+p[1]+'/review'):('/c/'+p[1]+'/submit');
}
history.replaceState(null,'',t+location.search);
}catch(e){}})();`;
}
