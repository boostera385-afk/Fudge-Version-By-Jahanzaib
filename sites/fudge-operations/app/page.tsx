import FudgeWorkbook from "../components/fudge-workbook";

export const dynamic = "force-dynamic";

export default async function Home() {
  return (
    <FudgeWorkbook
      userName="Fudge operator"
      canSignOut={false}
    />
  );
}
