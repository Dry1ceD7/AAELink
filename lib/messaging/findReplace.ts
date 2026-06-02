/**
 * findReplace — apply a list of literal find/replace rules to a string.
 *
 * Pulled out of the now-removed `lib/templateEngine.ts` Mustache engine so the
 * `/api/documents/find-replace` route does not depend on the rest of the
 * Mustache pipeline (placeholders, transforms, conditional/loop blocks). The
 * find string is matched literally (regex metacharacters are escaped); use the
 * `case_sensitive` and `whole_word` flags to refine matching.
 */

export interface FindReplaceRule {
  /** Substring to find (matched literally). */
  find: string
  /** Replacement string. */
  replace: string
  /** Default false. When false the search is case-insensitive. */
  case_sensitive?: boolean
  /** Default false. When true only whole-word occurrences are replaced. */
  whole_word?: boolean
}

const REGEX_META = /[.*+?^${}()|[\]\\]/g

/**
 * Apply each rule in order to the input text. Rules with an empty `find` are
 * skipped. Returns the transformed string.
 */
export function batchFindReplace(text: string, rules: FindReplaceRule[]): string {
  let result = text

  for (const rule of rules) {
    if (!rule.find) continue

    const escaped = rule.find.replace(REGEX_META, '\\$&')
    const pattern = rule.whole_word ? `\\b${escaped}\\b` : escaped
    const flags = rule.case_sensitive ? 'g' : 'gi'

    result = result.replace(new RegExp(pattern, flags), rule.replace)
  }

  return result
}
