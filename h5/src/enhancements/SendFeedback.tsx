import {Icon} from '../components/Icon';
import {sendFeedback} from './loader';
import {motionAllowed} from '../experience';
/** Eligibility is captured by the command caller. A late chunk cannot replay it. */
export function SendFeedback({pending,armed}:{pending:string|null;armed:boolean}){
 const kit=sendFeedback.get();
 return <span className="h5-send-slot" aria-hidden="true">{kit&&armed&&pending&&motionAllowed()?<kit.Send key={pending} animate loop={false} persistOnAnimateEnd completeOnStop={false} size={22} data-h5-flight="pending"/>:<Icon name="send" data-icon="inline-start"/>}</span>;
}
