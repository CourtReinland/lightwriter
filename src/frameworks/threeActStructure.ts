import type { FrameworkDefinition } from "./types";

export const threeActStructure: FrameworkDefinition = {
  id: "three-act",
  name: "Aristotle's Poetics",
  color: "#ef4444",
  beats: [
    {
      name: "Protasis (Setup)",
      description: "The beginning — introduce the characters, setting, and dramatic situation. Establish the protagonist's world and the seeds of conflict.",
      examples: [
        "Oedipus Rex: Oedipus is king, Thebes is plagued — he vows to find the cause",
        "Casablanca: Rick's cafe, wartime Casablanca, his cynical detachment established",
        "Parasite: The Kim family in their semi-basement apartment, folding pizza boxes",
      ],
      startPercent: 0, endPercent: 10,
    },
    {
      name: "Exciting Force",
      description: "The event that sets the central conflict in motion. The dramatic question is posed — will the protagonist achieve their goal?",
      examples: [
        "Oedipus Rex: The oracle declares the plague is caused by an unpunished murderer",
        "Casablanca: Ilsa walks into Rick's cafe — the past resurfaces",
        "Parasite: Ki-woo gets the opportunity to tutor for the wealthy Park family",
      ],
      startPercent: 10, endPercent: 15,
    },
    {
      name: "Epitasis (Rising Action)",
      description: "Complications multiply and the conflict intensifies. The protagonist pursues their goal but faces escalating obstacles.",
      examples: [
        "Oedipus Rex: Each witness reveals more disturbing truths about the king's past",
        "Casablanca: Rick, Ilsa, and Laszlo's triangle tightens under Nazi pressure",
        "Parasite: Each Kim family member infiltrates the Park household one by one",
      ],
      startPercent: 15, endPercent: 25,
    },
    {
      name: "First Reversal (Peripeteia)",
      description: "A significant change in fortune — the situation reverses. What seemed like progress becomes a setback, or vice versa. Aristotle considered this essential to great tragedy.",
      examples: [
        "Oedipus Rex: The messenger meant to comfort Oedipus reveals he was adopted",
        "Casablanca: Ilsa pulls a gun on Rick, then breaks down and confesses she still loves him",
        "Parasite: The Kims enjoy the empty Park house — then the old housekeeper returns",
      ],
      startPercent: 25, endPercent: 30,
    },
    {
      name: "Rising Complications",
      description: "The stakes increase dramatically. Multiple forces converge, alliances shift, and the protagonist faces their most complex challenges.",
      examples: [
        "Oedipus Rex: Jocasta realizes the truth before Oedipus does — begs him to stop investigating",
        "Casablanca: Rick must choose between love and duty as the Nazis close in",
        "Parasite: The secret basement dweller, the deception spiraling out of control",
      ],
      startPercent: 30, endPercent: 45,
    },
    {
      name: "Climax / Crisis",
      description: "The turning point of highest tension — the moment everything hinges on. The protagonist faces a critical decision or confrontation that determines the outcome.",
      examples: [
        "Oedipus Rex: The final shepherd confirms Oedipus killed his father and married his mother",
        "Casablanca: Rick holds Ilsa at the airport — will he let her go?",
        "Parasite: The birthday party erupts into violence in the garden",
      ],
      startPercent: 45, endPercent: 55,
    },
    {
      name: "Recognition (Anagnorisis)",
      description: "A moment of critical discovery — the protagonist realizes a truth about themselves, their situation, or another character. Aristotle paired this with peripeteia as the mark of great drama.",
      examples: [
        "Oedipus Rex: Oedipus fully comprehends that HE is the murderer he's been hunting",
        "Casablanca: Rick realizes the cause is bigger than his heartbreak",
        "Parasite: Ki-taek recognizes the fundamental contempt the Parks have for people like him",
      ],
      startPercent: 55, endPercent: 60,
    },
    {
      name: "Catastasis (Falling Action)",
      description: "The consequences of the climax play out. Events move toward resolution — either restoration of order or completion of tragedy.",
      examples: [
        "Oedipus Rex: Jocasta hangs herself; Oedipus blinds himself",
        "Casablanca: Rick orchestrates the escape plan, shoots Major Strasser",
        "Parasite: The aftermath of the garden violence — chaos, flight, hiding",
      ],
      startPercent: 60, endPercent: 75,
    },
    {
      name: "Second Reversal",
      description: "A final twist or reversal before the resolution — an unexpected turn that adds depth to the story's conclusion.",
      examples: [
        "Oedipus Rex: Oedipus, who sought to see the truth, now blinds himself to see clearly",
        "Casablanca: Captain Renault covers for Rick — 'Round up the usual suspects'",
        "Parasite: Ki-taek kills Mr. Park and disappears into the bunker",
      ],
      startPercent: 75, endPercent: 82,
    },
    {
      name: "Catastrophe / Denouement",
      description: "The final resolution — order is restored (comedy) or the tragic consequences are complete (tragedy). All threads are resolved.",
      examples: [
        "Oedipus Rex: Oedipus is exiled from Thebes, the plague lifts — order restored through suffering",
        "Casablanca: Ilsa and Laszlo fly to safety; Rick walks off with Renault",
        "Parasite: Ki-woo wakes from his coma; the family is destroyed; the father is trapped",
      ],
      startPercent: 82, endPercent: 92,
    },
    {
      name: "Catharsis",
      description: "The emotional release — the audience processes the experience through pity and fear. Aristotle believed this purging of emotion was the purpose of tragedy.",
      examples: [
        "Oedipus Rex: We feel pity for Oedipus and fear that fate could befall anyone",
        "Casablanca: Bittersweet satisfaction — love sacrificed for a greater cause",
        "Parasite: Ki-woo's fantasy of buying the house — we know it will never happen",
      ],
      startPercent: 92, endPercent: 100,
    },
  ],
};
