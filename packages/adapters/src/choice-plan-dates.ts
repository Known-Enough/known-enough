import { KnownEnough as KE, type ChoicePlan } from '@deal-table/contracts';

const months = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

/** Canonicalize only complete, unambiguous named dates; never infer a year or numeric locale. */
export function normalizeChoicePlanDates(plan: ChoicePlan): ChoicePlan {
  return { ...plan, topics: plan.topics.map(topic => topic.kind !== 'DATE' ? topic : {
    ...topic, options: topic.options.map(original => {
      const value = original.trim();
      const dayFirst = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(value);
      const monthFirst = /^([A-Za-z]+) (\d{1,2}),? (\d{4})$/.exec(value);
      const day = dayFirst?.[1] ?? monthFirst?.[2];
      const month = dayFirst?.[2] ?? monthFirst?.[1];
      const year = dayFirst?.[3] ?? monthFirst?.[3];
      if (!day || !month || !year) return original;
      const monthIndex = months.indexOf(month.toLowerCase());
      if (monthIndex < 0) return original;
      const date = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
      return KE.DecisionValue.safeParse({ type: 'DATE', date }).success ? date : original;
    }),
  }) };
}
