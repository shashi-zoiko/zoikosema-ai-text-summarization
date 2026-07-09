/* Bouncing-ball bar loader — from Uiverse.io by Nawsome, adapted for Zoiko
 * Sema: scoped class names (.zk-loader*) so the generic .loader selectors
 * can't leak, and colored from theme tokens so it reads on every theme.
 * Animations live in index.css. Kept the WalkingBirdLoader export name so
 * the single call site (MeetLobby) needs no change. */

export default function WalkingBirdLoader() {
  return (
    <div className="zk-loader" role="status" aria-label="Waiting for host approval">
      <div className="zk-loader__bar" />
      <div className="zk-loader__bar" />
      <div className="zk-loader__bar" />
      <div className="zk-loader__bar" />
      <div className="zk-loader__bar" />
      <div className="zk-loader__ball" />
    </div>
  )
}
