// One existing encrypted journal implementation; this H5-owned lazy entry keeps
// the production manifest rooted in H5 without copying storage or crypto logic.
export {openDraft,saveDraft,settleDraft,removeSensitiveDraft,purgeDrafts,hasExistingDraft,subscribeDrafts,matchesDraft} from '../../../pc-admin/src/features/drafts/encrypted-drafts';
