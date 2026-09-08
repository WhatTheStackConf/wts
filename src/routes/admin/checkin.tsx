import { clientOnly } from "@solidjs/web";
const AdminCheckinPage = clientOnly(() => import("~/components/checkin/AdminCheckinPage"));
export default function AdminCheckin() { return <AdminCheckinPage />; }
