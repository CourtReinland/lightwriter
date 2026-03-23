import type { FrameworkDefinition } from "./types";

export const saveTheCat: FrameworkDefinition = {
  id: "save-the-cat",
  name: "Save the Cat",
  color: "#3b82f6",
  beats: [
    {
      name: "Opening Image",
      description: "A single visual that sets the tone, mood, and starting point of the story. It's the 'before' snapshot of the protagonist's world.",
      examples: [
        "Legally Blonde: Elle Woods in her sorority, living a carefree life",
        "The Matrix: Trinity fighting agents — the world is not what it seems",
        "Juno: A teenager staring at a pregnancy test",
      ],
      startPercent: 0, endPercent: 1,
    },
    {
      name: "Theme Stated",
      description: "Someone (often not the hero) states the movie's thematic premise — usually in dialogue the hero doesn't fully understand yet.",
      examples: [
        "Legally Blonde: 'You're not smart enough' — Elle will prove otherwise",
        "The Dark Knight: 'You either die a hero or live long enough to see yourself become the villain'",
        "Juno: 'I think kids get bored of their toys' — about commitment and growing up",
      ],
      startPercent: 4, endPercent: 6,
    },
    {
      name: "Set-Up",
      description: "Introduce the hero's world, supporting characters, and the things that need fixing. Plant every character and element that will pay off later.",
      examples: [
        "Show the protagonist's flaws, routines, relationships, and what's at stake",
        "Introduce the best friend, love interest, antagonist in their current context",
        "Establish the 'six things that need fixing' in the hero's life",
      ],
      startPercent: 1, endPercent: 10,
    },
    {
      name: "Catalyst",
      description: "The inciting incident — a life-changing moment that knocks the hero out of their status quo. Nothing will ever be the same.",
      examples: [
        "Legally Blonde: Warner dumps Elle and she decides to follow him to Harvard Law",
        "The Matrix: Neo meets Trinity, then is contacted by Morpheus",
        "Juno: Juno discovers she's definitely pregnant",
      ],
      startPercent: 10, endPercent: 13,
    },
    {
      name: "Debate",
      description: "The hero wrestles with the decision the Catalyst demands. Should I go? Can I do this? What will happen if I don't?",
      examples: [
        "Legally Blonde: Can Elle really get into Harvard? Everyone doubts her",
        "The Matrix: Neo struggles with whether to trust Morpheus",
        "Juno: Should she keep the baby, abort, or find adoptive parents?",
      ],
      startPercent: 13, endPercent: 25,
    },
    {
      name: "Break into Two",
      description: "The hero makes a proactive choice and enters the upside-down version of their world — Act Two begins. This must be a decision, not something that happens to them.",
      examples: [
        "Legally Blonde: Elle arrives at Harvard Law — fish out of water",
        "The Matrix: Neo takes the red pill",
        "Juno: She chooses adoption and finds the Lorings",
      ],
      startPercent: 25, endPercent: 27,
    },
    {
      name: "B Story",
      description: "A secondary storyline begins — often a love story. The B Story carries the theme and provides the hero with new perspective.",
      examples: [
        "Legally Blonde: Elle meets Emmett, who sees her true potential",
        "The Matrix: Neo and Trinity's developing connection",
        "Juno: Juno's growing relationship with Mark Loring (the adoptive father)",
      ],
      startPercent: 27, endPercent: 30,
    },
    {
      name: "Fun and Games",
      description: "The promise of the premise — the trailer moments. The hero explores the new world, and we see the concept in action. Often the most entertaining section.",
      examples: [
        "Legally Blonde: Elle's fish-out-of-water moments at Harvard — standing out, proving doubters wrong",
        "The Matrix: Neo trains, learns kung fu, dodges bullets — 'I know kung fu'",
        "Juno: Juno's witty, awkward interactions navigating pregnancy and the Lorings",
      ],
      startPercent: 30, endPercent: 50,
    },
    {
      name: "Midpoint",
      description: "A false victory or false defeat that raises the stakes. The fun and games are over — things get real. New information changes everything.",
      examples: [
        "Legally Blonde: Elle wins Callahan's internship — false victory, things get harder",
        "The Matrix: The Oracle tells Neo he's not The One — false defeat",
        "Juno: Mark tells Juno he's leaving Vanessa — the perfect family illusion shatters",
      ],
      startPercent: 50, endPercent: 55,
    },
    {
      name: "Bad Guys Close In",
      description: "External pressure mounts AND internal doubts grow. The villain's plan advances, the team fractures, and everything that could go wrong does.",
      examples: [
        "Legally Blonde: Callahan sexually harasses Elle; she considers quitting",
        "The Matrix: Cypher betrays the crew to Agent Smith",
        "Juno: Mark moves out, the adoption is in jeopardy, Juno doubts everything",
      ],
      startPercent: 55, endPercent: 75,
    },
    {
      name: "All Is Lost",
      description: "The lowest point. Something or someone 'dies' — literally or metaphorically. There's a 'whiff of death' that makes the situation feel hopeless.",
      examples: [
        "Legally Blonde: Elle decides to drop out of law school entirely",
        "The Matrix: Morpheus is captured; the crew debates unplugging him (killing him)",
        "Juno: Sitting alone on the hospital steps, abandoned and heartbroken",
      ],
      startPercent: 75, endPercent: 78,
    },
    {
      name: "Dark Night of the Soul",
      description: "The hero processes the loss. Grief, reflection, despair — then a spark. They dig deep and find a reason to keep going.",
      examples: [
        "Legally Blonde: Elle's manicurist/mentor reminds her why she's worthy",
        "The Matrix: Neo decides to rescue Morpheus despite the odds",
        "Juno: Realizes what real love looks like — Vanessa's unconditional commitment",
      ],
      startPercent: 78, endPercent: 80,
    },
    {
      name: "Break into Three",
      description: "Eureka! The A and B stories combine — the hero finds the solution using lessons from both storylines. They choose to fight.",
      examples: [
        "Legally Blonde: Elle returns to the courtroom with a plan — her own way",
        "The Matrix: Neo announces 'I'm going in' — he believes in himself now",
        "Juno: Decides to give the baby to Vanessa alone — trusting her instinct",
      ],
      startPercent: 80, endPercent: 82,
    },
    {
      name: "Finale",
      description: "The hero executes the plan, defeats the bad guys, and proves their transformation. The lessons of the theme are applied in action.",
      examples: [
        "Legally Blonde: Elle wins the murder case using her unique knowledge",
        "The Matrix: Neo fights Agent Smith, dies, and is resurrected as The One",
        "Juno: The baby is born and given to Vanessa; Juno and Bleeker reunite",
      ],
      startPercent: 82, endPercent: 99,
    },
    {
      name: "Final Image",
      description: "The mirror of the Opening Image — proof of transformation. Shows how the hero and their world have changed.",
      examples: [
        "Legally Blonde: Elle graduates Harvard Law as class speaker — confident, respected",
        "The Matrix: Neo flies into the sky — he is The One, the world will change",
        "Juno: Playing guitar with Bleeker — peaceful, mature, at ease",
      ],
      startPercent: 99, endPercent: 100,
    },
  ],
};
