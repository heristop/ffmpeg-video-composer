// Drives one Generate-with-AI session: the optional Jev brief analysis and the generation run (plan
// first, optionally paused for review, then the template), each cancellable through its own
// AbortController (closing the dialog aborts both).
import { useEffect, useReducer, useRef, useState } from 'react';
import { routeBrief, type BriefRoute } from '@/application/usecases/ai-template/brief-router';
import { generationContext } from '@/application/usecases/ai-template/generation-context';
import type { TemplatePlan } from '@/application/usecases/ai-template/plan';
import { jevAsker } from '@/infrastructure/ai/typesafe-jev';
import { describeFailure, IDLE, runReducer, type FailureCopy } from './ai-generation.logic';
import { requestPlan, writeTemplate, type GenerateArgs } from './run-generation';

export type { GenerateArgs } from './run-generation';

export type RouteState =
  | { kind: 'none' }
  | { kind: 'routing' }
  | { kind: 'ready'; route: BriefRoute }
  | { kind: 'error'; error: FailureCopy };

function abort(ref: { current: AbortController | null }): AbortController {
  ref.current?.abort();
  const next = new AbortController();
  ref.current = next;

  return next;
}

export function useAiGeneration() {
  const [status, dispatch] = useReducer(runReducer, IDLE);
  const [route, setRoute] = useState<RouteState>({ kind: 'none' });
  const runRef = useRef<AbortController | null>(null);
  const routeRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      runRef.current?.abort();
      routeRef.current?.abort();
    },
    []
  );

  // The arguments of the run paused on its plan, so "Write template" can pick it up.
  const pendingRef = useRef<GenerateArgs | null>(null);

  const fail = (controller: AbortController, error: unknown): void => {
    dispatch({ type: 'fail', error: controller.signal.aborted ? new DOMException('Aborted', 'AbortError') : error });
  };

  const generate = async (args: GenerateArgs): Promise<void> => {
    const controller = abort(runRef);
    dispatch({ type: 'start', planning: args.planFirst });

    try {
      const plan = args.planFirst ? await requestPlan(args, controller.signal, dispatch) : null;

      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

      if (plan && args.reviewPlan) {
        pendingRef.current = args;
        dispatch({ type: 'plan-ready', plan });

        return;
      }

      await writeTemplate(args, plan, controller.signal, dispatch);
    } catch (error) {
      fail(controller, error);
    }
  };

  // Continue a run paused on its plan, with the plan as the user left it.
  const writeFromPlan = async (plan: TemplatePlan): Promise<void> => {
    const args = pendingRef.current;

    if (!args) return;

    const controller = abort(runRef);
    dispatch({ type: 'start' });

    try {
      await writeTemplate(args, plan, controller.signal, dispatch);
    } catch (error) {
      fail(controller, error);
    }
  };

  // Resolves with the route (null on failure or cancel) so a caller can generate straight after.
  const analyse = async (brief: string, jevKey: string): Promise<BriefRoute | null> => {
    const controller = abort(routeRef);
    setRoute({ kind: 'routing' });

    try {
      const context = generationContext();
      const next = await routeBrief(
        brief,
        context.samples,
        jevAsker(jevKey, controller.signal),
        context.catalog.themes
      );

      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

      setRoute({ kind: 'ready', route: next });

      return next;
    } catch (error) {
      // A newer analysis owns the state now; leave it alone.
      if (routeRef.current !== controller) return null;

      setRoute(controller.signal.aborted ? { kind: 'none' } : { kind: 'error', error: describeFailure(error, 'jev') });

      return null;
    }
  };

  return {
    status,
    route,
    generate,
    writeFromPlan,
    editPlan: (plan: TemplatePlan) => {
      dispatch({ type: 'edit-plan', plan });
    },
    analyse,
    cancel: () => {
      runRef.current?.abort();
      routeRef.current?.abort();
    },
    reset: () => {
      dispatch({ type: 'reset' });
    },
    clearRoute: () => {
      routeRef.current?.abort();
      setRoute({ kind: 'none' });
    },
  };
}
