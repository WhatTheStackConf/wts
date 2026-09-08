import { clientOnly } from "@solidjs/web";
const CheckinStationPage = clientOnly(() => import("~/components/checkin/CheckinStationPage"));
export default function Checkin() { return <CheckinStationPage />; }
