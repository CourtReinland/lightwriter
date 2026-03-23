import type { FrameworkDefinition } from "./types";

export const herosJourney: FrameworkDefinition = {
  id: "heros-journey",
  name: "Hero's Journey",
  color: "#60a5fa",
  beats: [
    {
      name: "Ordinary World",
      description: "The hero's everyday life before the story begins. Establishes who they are, what they value, and what's missing or broken in their world.",
      examples: [
        "Luke Skywalker farming on Tatooine, dreaming of something more",
        "Frodo living peacefully in the Shire",
        "Neo working a dead-end office job while sensing something is wrong",
      ],
      startPercent: 0, endPercent: 8,
    },
    {
      name: "Call to Adventure",
      description: "An event or message disrupts the hero's ordinary world and presents a challenge, quest, or opportunity that demands action.",
      examples: [
        "R2-D2 plays Leia's holographic distress message for Luke",
        "Gandalf tells Frodo about the Ring's true nature",
        "Morpheus contacts Neo and offers the truth about the Matrix",
      ],
      startPercent: 8, endPercent: 12,
    },
    {
      name: "Refusal of the Call",
      description: "The hero hesitates, doubts, or outright refuses the adventure. Fear, obligation, or insecurity holds them back.",
      examples: [
        "Luke tells Obi-Wan he can't go — he has responsibilities on the farm",
        "Frodo tries to give the Ring to Gandalf, not wanting the burden",
        "Neo initially chooses to leave Morpheus's car rather than follow instructions",
      ],
      startPercent: 12, endPercent: 15,
    },
    {
      name: "Meeting the Mentor",
      description: "The hero encounters a wise figure who provides guidance, training, tools, or confidence to face the journey ahead.",
      examples: [
        "Obi-Wan gives Luke his father's lightsaber and teaches him about the Force",
        "Gandalf counsels Frodo and arranges the Fellowship",
        "Morpheus trains Neo in the simulation and explains his potential",
      ],
      startPercent: 15, endPercent: 20,
    },
    {
      name: "Crossing the Threshold",
      description: "The hero fully commits to the adventure, leaving the familiar world behind and entering the unknown special world.",
      examples: [
        "Luke leaves Tatooine aboard the Millennium Falcon",
        "The Fellowship departs Rivendell for Mordor",
        "Neo takes the red pill and wakes up in the real world",
      ],
      startPercent: 20, endPercent: 25,
    },
    {
      name: "Tests, Allies, Enemies",
      description: "The hero navigates the special world, facing challenges, making allies, confronting enemies, and learning the new rules.",
      examples: [
        "Luke meets Han Solo, rescues Leia, and learns to trust the Force",
        "The Fellowship battles through Moria and encounters Gollum",
        "Neo trains with the crew, learns to bend the Matrix's rules",
      ],
      startPercent: 25, endPercent: 40,
    },
    {
      name: "Approach to Inmost Cave",
      description: "The hero and allies prepare for the major challenge ahead. Tension builds as they approach the most dangerous place or situation.",
      examples: [
        "The Rebels analyze the Death Star plans and prepare for the attack run",
        "The Fellowship approaches the Mines of Moria knowing danger awaits",
        "Neo and the crew prepare to enter the Matrix to visit the Oracle",
      ],
      startPercent: 40, endPercent: 45,
    },
    {
      name: "The Ordeal",
      description: "The hero faces their greatest challenge — a life-or-death crisis that forces transformation. This is the central dramatic moment.",
      examples: [
        "Luke is trapped in the Death Star's trash compactor; Obi-Wan sacrifices himself",
        "Gandalf falls fighting the Balrog in Moria",
        "Neo is killed by Agent Smith in the Matrix",
      ],
      startPercent: 45, endPercent: 55,
    },
    {
      name: "Reward (Seizing the Sword)",
      description: "Having survived the ordeal, the hero gains something valuable — knowledge, a weapon, reconciliation, or new power.",
      examples: [
        "Luke gains confidence in the Force after surviving the Death Star",
        "Aragorn claims his identity as the true king",
        "Neo realizes he is The One and can now control the Matrix",
      ],
      startPercent: 55, endPercent: 60,
    },
    {
      name: "The Road Back",
      description: "The hero begins the return journey, but faces renewed danger or urgency. The consequences of the ordeal are felt.",
      examples: [
        "The Rebels race to launch the final attack on the Death Star",
        "Frodo and Sam continue alone toward Mount Doom",
        "Neo must escape the Matrix while Agents pursue the ship in the real world",
      ],
      startPercent: 60, endPercent: 70,
    },
    {
      name: "Resurrection",
      description: "A final climactic test where the hero must use everything they've learned. A symbolic death and rebirth — the hero emerges transformed.",
      examples: [
        "Luke turns off his targeting computer and trusts the Force to destroy the Death Star",
        "Frodo claims the Ring at Mount Doom but Gollum's intervention destroys it",
        "Neo stands and fights Agent Smith, seeing the Matrix's code for the first time",
      ],
      startPercent: 70, endPercent: 85,
    },
    {
      name: "Return with the Elixir",
      description: "The hero returns to the ordinary world, transformed by the journey. They bring back something that benefits their community.",
      examples: [
        "Luke, Han, and Leia receive medals; the galaxy has new hope",
        "The hobbits return to a peaceful Shire; Frodo eventually sails to the Undying Lands",
        "Neo flies into the sky — humanity now has a champion against the machines",
      ],
      startPercent: 85, endPercent: 100,
    },
  ],
};
