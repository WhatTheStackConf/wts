import { clientOnly } from "@solidjs/web";
const FeedbackAdmin = clientOnly(() => import("~/components/admin/AdminFeedbackResults"));
export default function FeedbackAdminPage() { return <FeedbackAdmin />; }
