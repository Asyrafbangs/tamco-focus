/**
 * The guest pages' only chrome (§10, §11): the ESH mark and who this page
 * is for. No module switcher, no menu, no way into the staff application.
 */
export function GuestTopBar({ identity }: { identity: string }) {
  return (
    <header className="guest-topbar">
      <span className="guest-brand">
        <span className="esh-brand-mark" aria-hidden="true">
          E
        </span>
        <span>TAMCO ESH</span>
      </span>
      <span className="guest-identity">{identity}</span>
    </header>
  );
}
