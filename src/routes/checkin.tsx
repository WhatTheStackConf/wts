import { clientOnly } from "@solidjs/web";
const CheckinStationPage = clientOnly(() => import("~/components/checkin/CheckinScannerPage"));
export default function Checkin() { return <CheckinStationPage />; }
