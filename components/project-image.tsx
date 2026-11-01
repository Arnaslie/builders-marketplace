// Project picture, or a lettered placeholder while imageUrl is null (it is null in every fixture).
// A plain <img> is used on purpose: next/image needs each remote host listed in next.config,
// and we do not know the image hosts yet.
type Props = { title: string; imageUrl: string | null; ratio?: string };

export function ProjectImage({ title, imageUrl, ratio = "4 / 3" }: Props) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="thumb" src={imageUrl} alt="" style={{ aspectRatio: ratio }} />;
  }
  return (
    <div className="thumb-placeholder" style={{ aspectRatio: ratio }} aria-hidden="true">
      {title.charAt(0)}
    </div>
  );
}
