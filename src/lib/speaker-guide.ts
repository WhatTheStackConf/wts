import { speakerGuide } from ".velite";
import { hasValidSpeakerGuidePassword } from "~/lib/speaker-guide-access";

export interface SpeakerGuideContent {
  title: string;
  content: string;
}

export const fetchSpeakerGuide = async (
  password: string,
): Promise<SpeakerGuideContent | null> => {
  "use server";
  const url = new URL("https://wts.sh/speaker-guide");
  url.searchParams.set("pw", password);

  return hasValidSpeakerGuidePassword(url) ? speakerGuide : null;
};
