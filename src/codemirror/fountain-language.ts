import { StreamLanguage, type StringStream } from "@codemirror/language";

interface FountainState {
  inDialogue: boolean;
  inNote: boolean;
  inBoneyard: boolean;
  afterCharacter: boolean;
  prevLineBlank: boolean;
}

const fountainStreamParser = {
  startState(): FountainState {
    return {
      inDialogue: false,
      inNote: false,
      inBoneyard: false,
      afterCharacter: false,
      prevLineBlank: true, // Start of doc counts as "after blank"
    };
  },

  token(stream: StringStream, state: FountainState): string | null {
    // Boneyard (block comment): /* ... */
    if (state.inBoneyard) {
      if (stream.match(/.*?\*\//)) {
        state.inBoneyard = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }
    if (stream.match(/\/\*/)) {
      state.inBoneyard = true;
      return "comment";
    }

    // Notes: [[ ... ]]
    if (state.inNote) {
      if (stream.match(/.*?\]\]/)) {
        state.inNote = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }
    if (stream.match(/\[\[/)) {
      state.inNote = true;
      return "comment";
    }

    // Beginning of line checks
    if (stream.sol()) {
      // Track whether previous line was blank (for character name detection)
      const thisLineBlank = /^\s*$/.test(stream.string);
      // prevLineBlank was set at the end of processing the previous line
      state.afterCharacter = false;

      // Page break: ===
      if (stream.match(/^===+\s*$/)) {
        return "contentSeparator";
      }

      // Synopsis: = text
      if (stream.match(/^=(?!=)/)) {
        stream.skipToEnd();
        return "meta";
      }

      // Section headings: # ## ###
      if (stream.match(/^#{1,3}\s/)) {
        stream.skipToEnd();
        return "heading";
      }

      // Scene headings: INT. EXT. EST. INT./EXT. I/E or forced with .
      if (
        stream.match(
          /^\.((?!\.)\S)|^(INT|EXT|EST|INT\.\/EXT|I\/E)[.\s]/i,
        )
      ) {
        stream.skipToEnd();
        return "keyword";
      }

      // Transitions: > text or lines ending in TO:
      if (stream.match(/^>/)) {
        stream.skipToEnd();
        return "processingInstruction";
      }

      // Centered: >text<
      // Already handled by > above, but the < ending distinguishes it visually

      // !! prefix → Shot (camera direction) — always action-like, never character
      if (stream.match(/^!!/)) {
        stream.skipToEnd();
        return null; // No special color — just plain text
      }

      // ! prefix → Forced action — never character
      if (stream.match(/^!/)) {
        stream.skipToEnd();
        return null;
      }

      // Character name: @-forced character is always a character.
      // ALL CAPS lines are only colored as character if preceded by blank line.
      // (The formatting plugin handles the full look-ahead validation for indentation;
      //  the syntax coloring here is a best-effort that may occasionally color a shot
      //  line — but the indentation will be correct from the formatting plugin.)
      if (stream.match(/^@/)) {
        state.inDialogue = true;
        state.afterCharacter = true;
        stream.skipToEnd();
        return "variableName";
      }
      if (state.prevLineBlank && stream.match(/^[A-Z][A-Z0-9 ._\-']*((\s*\(.*\))?)\s*\^?\s*$/)) {
        state.inDialogue = true;
        state.afterCharacter = true;
        stream.skipToEnd();
        return "variableName";
      }

      // Parenthetical in dialogue
      if (state.inDialogue && stream.match(/^\s*\(.*\)\s*$/)) {
        stream.skipToEnd();
        return "bracket";
      }

      // Dialogue continuation
      if (state.inDialogue && !stream.match(/^\s*$/, false)) {
        stream.skipToEnd();
        return "string";
      }

      // Empty line ends dialogue
      if (state.inDialogue && stream.match(/^\s*$/, false)) {
        state.inDialogue = false;
      }

      // Update prevLineBlank for the NEXT line's character detection
      state.prevLineBlank = thisLineBlank;

      // Title page key: value
      if (stream.match(/^(Title|Credit|Author|Authors|Source|Draft date|Date|Contact|Copyright|Notes|Revision)\s*:/i)) {
        stream.skipToEnd();
        return "labelName";
      }

      // Transition at end of line: TO:
      const lineContent = stream.string;
      if (/^\s*[A-Z ]+TO:\s*$/.test(lineContent)) {
        stream.skipToEnd();
        return "processingInstruction";
      }
    }

    // Inline formatting
    if (stream.match(/\*\*\*/)) return "strong";
    if (stream.match(/\*\*/)) return "strong";
    if (stream.match(/\*/)) return "emphasis";
    if (stream.match(/_/)) return "emphasis";

    stream.next();
    return state.inDialogue ? "string" : null;
  },
};

export const fountainLanguage = StreamLanguage.define(fountainStreamParser);
