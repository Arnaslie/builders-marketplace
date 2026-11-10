import { SealMark } from "../seal";

// A 236x40 "publication banner", after the two Factbook banners on the 1994 CIA page.
// "olive" copies the textured brown World Factbook banner (small white lettering left, gold italic
// title and a big white number right); "ivory" copies the cream Factbook on Intelligence banner
// (bold black centred lettering). Rows alternate between them. It is decoration: the project title
// follows it as real link text, so the banner is hidden from screen readers.
type Props = { number: number; variant: "olive" | "ivory" };

export function Banner({ number, variant }: Props) {
  const no = String(number).padStart(3, "0");
  if (variant === "olive") {
    return (
      <span className="banner banner--olive" aria-hidden="true">
        <SealMark size={28} />
        <span className="banner-agency">
          Builders
          <br />
          Marketplace
          <br />
          Server
        </span>
        <span className="banner-title">
          <i>
            The <span className="banner-caps">PROJECT FILE</span>
          </i>
          <span className="banner-number">{no}</span>
        </span>
      </span>
    );
  }
  return (
    <span className="banner banner--ivory" aria-hidden="true">
      <SealMark size={30} />
      <span className="banner-plain">
        Project File
        <br />
        No. {no}
      </span>
    </span>
  );
}
