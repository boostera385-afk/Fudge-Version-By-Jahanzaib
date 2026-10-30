import FudgeDashboard from "../components/fudge-dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  return (
    <FudgeDashboard
      userName="Fudge operator"
      canSignOut
    />
  );
}
