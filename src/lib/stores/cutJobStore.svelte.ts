import type { CutJob } from "$lib/types";
import { subscribeUserJobs } from "$lib/firebase/firestore";
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
			(err) => {
				console.error("[cutJobStore]", err);
				error   = "Couldn't load your cut history.";
				loading = false;
			},
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

	return {
		get jobs()    { return jobs; },
		get loading() { return loading; },
		get error()   { return error; },
		init,
		cleanup,
	};
}

export const cutJobStore = createCutJobStore();
