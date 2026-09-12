import { clientOnly } from "@solidjs/web";
const RegistrationsPage = clientOnly(() => import("~/components/RegistrationsPage"));
export default function Registrations() { return <RegistrationsPage />; }
