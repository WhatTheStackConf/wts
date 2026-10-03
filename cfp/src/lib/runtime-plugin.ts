import { openCfpDatabase } from "~/server/storage";

export default function () {
  const database = openCfpDatabase();
  database.close();
}
