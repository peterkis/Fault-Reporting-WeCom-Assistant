import {useQuery} from '@tanstack/react-query';
import {displayProfileOptions} from '../api/display-profile';
import {useIdentity,useProfile,useSessionStatus} from '../session';

/** Optional enrichment starts only in display consumers after entry is ready. */
export function useDisplayProfile(){
 const session=useIdentity(),profile=useProfile(),status=useSessionStatus();
 const query=useQuery({...displayProfileOptions(session.recovery_scope,status.membershipRevision),enabled:!status.checking&&(!profile.name||!profile.department)});
 return {...profile,name:profile.name||query.data?.name||null,department:profile.department||query.data?.department||null};
}
