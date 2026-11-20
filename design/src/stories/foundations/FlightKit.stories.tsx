import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SPECIMENS, type Specimen } from "../../flight-kit/specimens";

// The canonical control recipes. Each app copies them onto its own class names:
// site public-links.css and newsletter.css, auth account.css, blog controls.css, cfp app.css.
function Kit(props: { specimen: Specimen }) {
  let host!: HTMLDivElement;
  const mark = () => host.querySelectorAll<HTMLInputElement>(".sp-indeterminate").forEach((input) => { input.indeterminate = true; });
  queueMicrotask(mark);
  // No site shell: site link rules would color the kit links. The kit page had no site CSS either.
  return <div class="sb-page fk">
    <h1>{props.specimen.title}</h1>
    {props.specimen.note ? <p>{props.specimen.note}</p> : null}
    <div class="sb-kit" ref={host} innerHTML={props.specimen.html} />
  </div>;
}

const meta = { title: "Foundations/Flight kit", parameters: { app: "site" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const story = (n: number): Story => {
  const specimen = SPECIMENS.find((item) => item.n === n)!;
  return { name: specimen.title, render: () => <Kit specimen={specimen} /> };
};

export const Plate = story(1);
export const Frame = story(2);
export const IconButton = story(3);
export const Links = story(4);
export const Fields = story(5);
export const Choices = story(6);
export const Fieldset = story(7);
export const Tabs = story(8);
export const Stepper = story(9);
export const ChipsAndTags = story(10);
export const Notice = story(11);
export const Table = story(12);
export const Pagination = story(13);
export const Disclosure = story(14);
export const Menu = story(15);
export const TooltipAndKbd = story(16);
export const Progress = story(17);
export const SkipLink = story(18);
export const Dialog = story(19);
