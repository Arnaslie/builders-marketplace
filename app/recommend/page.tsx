import { RecommendForm } from "../../components/recommend-form";

export const metadata = { title: "Recommend a project | DIY Wikipedia" };

export default function RecommendPage() {
  return (
    <main>
      <h1>Recommend a project</h1>
      <p className="lede">
        Describe a build you would like to see. We draft the materials list and price what we can from our cache.
        Items we cannot price are shown as unpriced.
      </p>
      <RecommendForm />
    </main>
  );
}
