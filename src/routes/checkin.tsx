import { clientOnly } from "@solidjs/web";
const CheckinScannerPage = clientOnly(() => import("~/components/checkin/CheckinScannerPage"));
export default function Checkin() { return <CheckinScannerPage />; }
