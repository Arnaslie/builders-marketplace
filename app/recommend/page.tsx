import { RecommendForm } from "../../components/recommend-form";

export const metadata = { title: "Recommend a project | Builders Marketplace" };

export default function RecommendPage() {
  return (
    <main>
      <h1>Recommend a project</h1>
      <p className="lede">
        Describe a build you would like to see. Add what it needs; prices are filled in later, so none are asked for
        here.
      </p>
      <RecommendForm />
    </main>
  );
}
