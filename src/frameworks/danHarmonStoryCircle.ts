import type { FrameworkDefinition } from "./types";

export const danHarmonStoryCircle: FrameworkDefinition = {
  id: "dan-harmon-story-circle",
  name: "Dan Harmon Story Circle",
  color: "#f97316",
  beats: [
    {
      name: "You",
      description: "Establish the protagonist in a zone of comfort: their ordinary world, default behavior, social mask, and the emotional pattern the episode will challenge.",
      examples: [
        "Community: Jeff begins inside the study group dynamic he thinks he can control",
        "Rick and Morty: Morty starts in the familiar family/school world before the portal opens",
        "A pilot cold open shows the hero's normal coping strategy before the story pressures it",
      ],
      startPercent: 0,
      endPercent: 12.5,
    },
    {
      name: "Need",
      description: "A desire, flaw, problem, or contradiction becomes unavoidable. The hero wants something, lacks something, or is forced to admit a need.",
      examples: [
        "The hero wants status, love, safety, revenge, escape, or proof they matter",
        "A scene exposes the gap between who the hero claims to be and what they actually need",
        "The episode's engine turns on when comfort is no longer enough",
      ],
      startPercent: 12.5,
      endPercent: 25,
    },
    {
      name: "Go",
      description: "The hero crosses into an unfamiliar situation. This can be literal travel, a new relationship dynamic, a lie they must maintain, or a social arena with new rules.",
      examples: [
        "A sitcom character enters a party, workplace crisis, courtroom, date, or family dinner where normal tricks fail",
        "A genre hero accepts the mission and leaves the safe world",
        "The story moves from setup into the upside-down version of the hero's life",
      ],
      startPercent: 25,
      endPercent: 37.5,
    },
    {
      name: "Search",
      description: "The hero adapts, experiments, investigates, and pays the cost of moving through the unfamiliar world. Complications reveal what the episode is really testing.",
      examples: [
        "The hero tries plans A, B, and C while the situation gets funnier, stranger, or more dangerous",
        "Allies and rivals reveal the rules of the new arena",
        "The middle section mines the premise for obstacles and discoveries",
      ],
      startPercent: 37.5,
      endPercent: 50,
    },
    {
      name: "Find",
      description: "The hero gets what they wanted, or thinks they do. This midpoint prize, answer, kiss, clue, or victory changes the terms of the story.",
      examples: [
        "The hero wins the argument but loses the room",
        "A clue solves one mystery while revealing a deeper problem",
        "A romantic or social victory turns out to carry an unexpected cost",
      ],
      startPercent: 50,
      endPercent: 62.5,
    },
    {
      name: "Take",
      description: "The hero pays a price for the thing they found. Consequences arrive; the story takes back comfort, innocence, certainty, or a relationship advantage.",
      examples: [
        "The lie collapses, the monster bites back, or the group turns on the hero",
        "The hero realizes the prize was incomplete, dangerous, or morally compromised",
        "A comedy escalates from clever scheme to painful consequence",
      ],
      startPercent: 62.5,
      endPercent: 75,
    },
    {
      name: "Return",
      description: "The hero heads back toward the familiar world carrying the consequences of the journey. They must bring the lesson home or repair the damage.",
      examples: [
        "The hero returns to the apartment, family, office, or group with new information",
        "The episode resolves external trouble while testing whether the hero has learned anything",
        "The protagonist tries to restore balance, but not by becoming exactly who they were before",
      ],
      startPercent: 75,
      endPercent: 87.5,
    },
    {
      name: "Change",
      description: "The hero is transformed, even if only slightly. The ending shows the emotional delta: a lesson accepted, rejected, inverted, or tragically missed.",
      examples: [
        "A button scene proves the hero has changed, or comically refuses to change",
        "The final image mirrors the opening but with a new emotional charge",
        "The episode lands because the external plot expresses an internal movement",
      ],
      startPercent: 87.5,
      endPercent: 100,
    },
  ],
};
