import type { CutJob } from "$lib/types";
import { saveJob, subscribeUserJobs } from "$lib/firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";

function createCutJobStore() {
	let jobs    = $state<CutJob[]>([]);
	let loading = $state(false);
	let error   = $state("");
	let _unsub: Unsubscribe | null = null;
	let _uid: string | null = null;

	function init(uid: string) {
		if (_unsub && _uid === uid) return;
		cleanup();
		_uid     = uid;
		loading  = true;
		error    = "";
		_unsub = subscribeUserJobs(
			uid,
			(updated) => {
				jobs    = updated;
				loading = false;
			},
			100,
		);
	}

	function cleanup() {
		_unsub?.();
		_unsub   = null;
		_uid     = null;
		jobs     = [];
		loading  = false;
		error    = "";
	}

	function addJob(job: CutJob) {
		// Optimistic local insert so the UI reflects the new job immediately.
		jobs = [job, ...jobs.filter((j) => j.id !== job.id)];
		saveJob(job).catch(() => {});
	}

	return {
		get jobs()    { return jobs; },
		get loading() { return loading; },
		get error()   { return error; },
		init,
		cleanup,
		addJob,
	};
}

export const cutJobStore = createCutJobStore();
