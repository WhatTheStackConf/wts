import { useParams } from "@solidjs/router";
import { Show } from "solid-js";
import { RegistrationClosed } from "~/components/RegistrationClosed";
import { qrDiscountSlugs } from "~/lib/qr-discounts";
import NotFound from "~/routes/[...404]";

export default function QrDiscountRoute() {
  const params = useParams();
  return (
    <Show when={qrDiscountSlugs.some(slug => slug === params.slug)} fallback={<NotFound />}>
      <RegistrationClosed />
    </Show>
  );
}
