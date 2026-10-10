// The member page consumes the existing bounded T03 journal. Its scope uses the
// server's opaque current binding digest and Web request reference, never a W identity.
export {openDraft,saveDraft,settleDraft,removeSensitiveDraft,hasExistingDraft,purgeDrafts,subscribeDrafts,matchesDraft} from './features/drafts/encrypted-drafts';
