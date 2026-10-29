import { redirect } from "next/navigation";
import FudgeWorkbook from "../components/fudge-workbook";
import { isAllowedUser } from "../lib/access";
import { freebuff } from "../lib/freebuff";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await freebuff.getUser();
  if (!user) redirect(`/auth/freebuff/signin?returnTo=${encodeURIComponent("/")}`);

  if (!isAllowedUser(user)) {
    return (
      <main className="access-denied">
        <div>
          <strong>Fudge Operations</strong>
          <h1>Access is not enabled for this account</h1>
          <p>{user.email || user.name || "This Freebuff account"} cannot open this dashboard.</p>
          <form method="post" action="/auth/freebuff/signout">
            <button type="submit">Sign out</button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <FudgeWorkbook
      userName={user.name || user.email || "Fudge operator"}
      canSignOut
    />
  );
}
