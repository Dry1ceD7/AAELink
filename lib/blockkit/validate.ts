/**
 * D7 Developer platform — Block Kit block validation.
 *
 * Structural validation of a Block Kit block array (the equivalent Slack uses
 * for rich messages, modals, and app home). Pure and dependency-free so it can
 * gate any surface that accepts blocks — messages, views, app home — before the
 * payload is stored or rendered. It checks shape, not semantics: types are on
 * the allow-list, required fields are present and typed, and documented limits
 * are respected.
 */

export interface BlockError {
  path: string
  message: string
}

const BLOCK_TYPES = new Set(['section', 'divider', 'header', 'image', 'context', 'actions', 'input'])
const TEXT_TYPES = new Set(['plain_text', 'mrkdwn'])
const INTERACTIVE_TYPES = new Set([
  'button', 'static_select', 'external_select', 'users_select', 'conversations_select',
  'channels_select', 'multi_static_select', 'multi_external_select', 'multi_users_select',
  'multi_conversations_select', 'multi_channels_select', 'datepicker', 'timepicker',
  'overflow', 'checkboxes', 'radio_buttons', 'plain_text_input',
])

const MAX_BLOCKS = 50
const MAX_ACTIONS_ELEMENTS = 25
const MAX_CONTEXT_ELEMENTS = 10
const MAX_SECTION_FIELDS = 10
const MAX_HEADER_LEN = 150

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function checkText(v: unknown, path: string, errors: BlockError[], opts: { plainOnly?: boolean } = {}): void {
  if (!isObject(v)) { errors.push({ path, message: 'must_be_text_object' }); return }
  const type = v.type
  if (typeof type !== 'string' || !TEXT_TYPES.has(type)) {
    errors.push({ path: `${path}.type`, message: 'must_be plain_text|mrkdwn' })
  } else if (opts.plainOnly && type !== 'plain_text') {
    errors.push({ path: `${path}.type`, message: 'must_be plain_text' })
  }
  if (typeof v.text !== 'string' || !v.text) errors.push({ path: `${path}.text`, message: 'required_non_empty' })
}

function checkInteractive(v: unknown, path: string, errors: BlockError[]): void {
  if (!isObject(v)) { errors.push({ path, message: 'must_be_object' }); return }
  const type = v.type
  if (typeof type !== 'string' || !INTERACTIVE_TYPES.has(type)) {
    errors.push({ path: `${path}.type`, message: 'not_an_interactive_element' })
    return
  }
  if (type === 'button') checkText(v.text, `${path}.text`, errors, { plainOnly: true })
}

function checkBlock(block: unknown, path: string, errors: BlockError[]): void {
  if (!isObject(block)) { errors.push({ path, message: 'must_be_object' }); return }
  const type = block.type
  if (typeof type !== 'string' || !BLOCK_TYPES.has(type)) {
    errors.push({ path: `${path}.type`, message: 'unknown_block_type' })
    return
  }

  switch (type) {
    case 'divider':
      break
    case 'section':
      if (block.text === undefined && block.fields === undefined) {
        errors.push({ path, message: 'section_requires_text_or_fields' })
      }
      if (block.text !== undefined) checkText(block.text, `${path}.text`, errors)
      if (block.fields !== undefined) {
        if (!Array.isArray(block.fields) || block.fields.length < 1 || block.fields.length > MAX_SECTION_FIELDS) {
          errors.push({ path: `${path}.fields`, message: `1-${MAX_SECTION_FIELDS}_items` })
        } else {
          block.fields.forEach((f, i) => checkText(f, `${path}.fields[${i}]`, errors))
        }
      }
      if (block.accessory !== undefined) checkInteractive(block.accessory, `${path}.accessory`, errors)
      break
    case 'header': {
      checkText(block.text, `${path}.text`, errors, { plainOnly: true })
      const t = isObject(block.text) ? block.text.text : undefined
      if (typeof t === 'string' && t.length > MAX_HEADER_LEN) {
        errors.push({ path: `${path}.text`, message: `max_${MAX_HEADER_LEN}_chars` })
      }
      break
    }
    case 'image':
      if (typeof block.image_url !== 'string' || !block.image_url) errors.push({ path: `${path}.image_url`, message: 'required' })
      if (typeof block.alt_text !== 'string') errors.push({ path: `${path}.alt_text`, message: 'required' })
      break
    case 'context':
      if (!Array.isArray(block.elements) || block.elements.length < 1 || block.elements.length > MAX_CONTEXT_ELEMENTS) {
        errors.push({ path: `${path}.elements`, message: `1-${MAX_CONTEXT_ELEMENTS}_items` })
      } else {
        block.elements.forEach((el, i) => {
          if (isObject(el) && el.type === 'image') {
            if (typeof el.image_url !== 'string' || !el.image_url) errors.push({ path: `${path}.elements[${i}].image_url`, message: 'required' })
          } else {
            checkText(el, `${path}.elements[${i}]`, errors)
          }
        })
      }
      break
    case 'actions':
      if (!Array.isArray(block.elements) || block.elements.length < 1 || block.elements.length > MAX_ACTIONS_ELEMENTS) {
        errors.push({ path: `${path}.elements`, message: `1-${MAX_ACTIONS_ELEMENTS}_items` })
      } else {
        block.elements.forEach((el, i) => checkInteractive(el, `${path}.elements[${i}]`, errors))
      }
      break
    case 'input':
      checkText(block.label, `${path}.label`, errors, { plainOnly: true })
      checkInteractive(block.element, `${path}.element`, errors)
      break
  }
}

export interface ValidateBlocksResult {
  ok: boolean
  errors: BlockError[]
}

/** Validate a Block Kit block array. Returns ok plus any structural errors. */
export function validateBlocks(blocks: unknown): ValidateBlocksResult {
  const errors: BlockError[] = []
  if (!Array.isArray(blocks)) {
    return { ok: false, errors: [{ path: 'blocks', message: 'must_be_array' }] }
  }
  if (blocks.length > MAX_BLOCKS) {
    errors.push({ path: 'blocks', message: `max_${MAX_BLOCKS}_blocks` })
  }
  blocks.forEach((b, i) => checkBlock(b, `blocks[${i}]`, errors))
  return { ok: errors.length === 0, errors }
}
