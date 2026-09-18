// Organizer catalogue. Import at server boundaries only: accepted answers are private.
import type { QuestionnaireDefinition } from "~/lib/mission-questions";

export interface BoothAchievement {
  key: string;
  booth: string;
  printedLabel: string;
  lookupPrefix: string;
  name: string;
  question: string;
  choices: [string, string, string];
  correctIndex: number;
  programmeSlug?: string;
}

export const WTS_2026_BOOTH_ACHIEVEMENTS: readonly BoothAchievement[] = [
  { key: "uni-bank", booth: "Уни банка", printedLabel: "0x48", lookupPrefix: "D0XXB6TD", name: "Neon Cred", question: "Which film inspired this year's WTS visual identity?", choices: ["Tron", "Blade Runner", "The Matrix"], correctIndex: 1 },
  { key: "mechanical-faculty", booth: "Машински факултет", printedLabel: "0x28", lookupPrefix: "BD219GBF", name: "More Human Than Hardware", question: "What are the human-like artificial beings in Blade Runner called?", choices: ["Replicants", "Hobbits", "Jedi"], correctIndex: 0 },
  { key: "symphony", booth: "Symphony", printedLabel: "0x02", lookupPrefix: "9490XQCF", name: "Electric Dreams", question: "Which genre best describes Blade Runner's neon-lit, high-tech world?", choices: ["Medieval fantasy", "Western", "Cyberpunk"], correctIndex: 2 },
  { key: "sorsix", booth: "Sorsix", printedLabel: "0x22", lookupPrefix: "2V4G5VWX", name: "Signal in the Rain", question: "The WTS talk 'Building Cleaner Angular Applications with Signal Forms' is about which framework?", choices: ["Angular", "Django", "Rails"], correctIndex: 0, programmeSlug: "cleaner-angular-applications-signals" },
  { key: "avenga", booth: "Avenga", printedLabel: "0x30", lookupPrefix: "CWX271AC", name: "Legacy Runner", question: "In software, what does 'legacy' usually refer to?", choices: ["Code that only runs in the future", "Older systems we still maintain and use", "A programming language for flying cars"], correctIndex: 1, programmeSlug: "legacy-in-it-breaking-stereotypes-understanding-reality-and-embracing-the-uncool" },
  { key: "loka", booth: "Loka", printedLabel: "0x20", lookupPrefix: "J3ZX2CAE", name: "Context Is Reality", question: "For an AI assistant, what is 'context'?", choices: ["Its screen brightness", "The colour of its logo", "The information it has available when responding"], correctIndex: 2, programmeSlug: "context-is-their-reality" },
  { key: "codechem", booth: "Codechem", printedLabel: "0x26", lookupPrefix: "PD4CZJJC", name: "Synthetic Alchemist", question: "What is code review?", choices: ["Checking and discussing code changes before they are merged", "Choosing a new editor colour theme", "Rating the office coffee"], correctIndex: 0, programmeSlug: "a-brief-history-of-code-review" },
  { key: "rldatix", booth: "RLDatix", printedLabel: "0x24", lookupPrefix: "0JSB41Q0", name: "The Empathy Protocol", question: "The WTS talk 'What makes AI work in a hospital, and what makes it harder' puts AI in which setting?", choices: ["A spaceport", "A hospital", "A racing circuit"], correctIndex: 1, programmeSlug: "ai-in-a-hospital" },
  { key: "jetbrains", booth: "JETBRAINS", printedLabel: "0x32", lookupPrefix: "MGVGM22F", name: "Nexus Coder", question: "The WTS talk 'One Project, Three Ways I Changed How I Write Kotlin' focuses on which language?", choices: ["COBOL", "Klingon", "Kotlin"], correctIndex: 2, programmeSlug: "one-project-three-ways-kotlin" },
  { key: "finki-vezilka", booth: "ФИНКИ (везилка)", printedLabel: "0x01", lookupPrefix: "GNW9EHBJ", name: "Threads of Tomorrow", question: "At the ФИНКИ везилка booth, which craft is being combined with technology?", choices: ["Embroidery", "Glassblowing", "Pottery"], correctIndex: 0 },
  { key: "robot-team", booth: "Робот тим", printedLabel: "0x18", lookupPrefix: "CS1FN64K", name: "Replicant Handshake", question: "What helps a robot detect what is happening around it?", choices: ["A lucky charm", "Sensors", "A conference lanyard"], correctIndex: 1 },
  { key: "rocket-team", booth: "Ракета тим", printedLabel: "0x34", lookupPrefix: "YZS50F7J", name: "Off-World Bound", question: "What provides the thrust that lifts a rocket?", choices: ["Wi-Fi signals", "Neon lights", "Its engine expelling exhaust"], correctIndex: 2 },
];

export function boothAchievementKey(entry: BoothAchievement): string { return `wts26.booth.${entry.key}`; }
export function boothQuestionnaire(entry: BoothAchievement): QuestionnaireDefinition {
  return { policy: "correct_or_half", questions: [{
    id: "question", kind: "single_choice", prompt: entry.question,
    choices: entry.choices.map((label, index) => ({ id: `option_${index + 1}`, label })),
    acceptedAnswers: [`option_${entry.correctIndex + 1}`],
  }] };
}
