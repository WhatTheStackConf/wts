import { clientOnly } from "@solidjs/web";
const CheckinTools = clientOnly(() => import("~/components/checkin/CheckinToolsPage"));
/** Secondary operator recovery/setup console; the normal scanner is /checkin. */
export default function Tools() { return <CheckinTools />; }
