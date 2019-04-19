import React, { Component } from 'react'
import { Editor, getEventRange, getEventTransfer } from 'slate-react'
import { Range, Mark, Point } from 'slate'
import { keyboardEvent } from '@slate-editor/utils'
import DeepTable from 'slate-deep-table'

import schema from '../lib/schema'
import initialValue from '!!raw-loader!../lib/value.mdx'
// import originalInitialValue from "../lib/value.json";
import { parseMDX, serializer } from '../lib/mdx-serializer'

import Node from './Node'
import MarkComponent from './Mark'
import SelectionMenu from './SelectionMenu'
import { getTypeFromMarkdown, isUrl, isImageUrl, isAllChar } from '../lib/util'

const plugins = [DeepTable({})]

const insertImage = (change, src, target) => {
  if (target) {
    change.select(target)
  }

  change.insertBlock({
    type: 'image',
    data: { src }
  })
}

const insertUnfurl = (change, href, target) => {
  if (target) {
    change.select(target)
  }

  change.insertBlock({
    type: 'unfurl',
    data: { href }
  })
}

const NodeRenderer = handleChange => props => (
  <Node onChange={handleChange} {...props} />
)

class BlockEditor extends Component {
  constructor(props) {
    super(props)

    this.state = {
      value: serializer.deserialize(
        parseMDX(props.initialValue || initialValue)
      )
    }

    this.selectionMenu = React.createRef()
  }

  componentDidMount = () => {
    this.updateSelectionMenu()
  }

  componentDidUpdate = () => {
    this.updateSelectionMenu()
  }

  emitChange = () => {
    const { value } = this.state
    this.props.onChange({ value })
  }

  updateSelectionMenu = () => {
    const selectionMenu = this.selectionMenu.current
    if (!selectionMenu) return

    const { value } = this.state
    const { fragment, selection } = value

    const hasNoSelection =
      selection.isBlurred || selection.isCollapsed || fragment.text === ''

    if (hasNoSelection && !this.state.selectionMenu) {
      return selectionMenu.removeAttribute('style')
    }

    const native = window.getSelection()
    const range = native.getRangeAt(0)
    const rect = range.getBoundingClientRect()

    selectionMenu.style.opacity = 1
    selectionMenu.style.top = `${rect.top +
      window.pageYOffset -
      selectionMenu.offsetHeight}px`

    selectionMenu.style.left = `${rect.left +
      window.pageXOffset -
      selectionMenu.offsetWidth / 2 +
      rect.width / 2}px`
  }

  handleChange = ({ value }) => {
    this.setState({ value }, this.emitChange)
  }

  handleBackTick = (event, change, next) => {
    this.handleInlineMark({
      event,
      change,
      next,
      character: '`',
      type: 'code'
    })
  }

  handleAsterisk = (event, change, next) => {
    this.handleInlineMark({
      event,
      change,
      next,
      character: '*',
      type: 'bold'
    })
  }

  handleUnderscore = (event, change, next) => {
    this.handleInlineMark({
      event,
      change,
      next,
      character: '_',
      type: 'italic'
    })
  }

  handleInlineMark = ({ event, change, next, character, type }) => {
    const { texts, selection } = change.value
    const currentTextNode = texts.get(0)
    const currentLineText = currentTextNode.text

    if (isAllChar(character, currentLineText)) {
      return
    }

    const [other, remainder] = currentLineText.startsWith(character)
      ? ['', currentLineText.replace(character, '')]
      : currentLineText.split(character)

    if (remainder) {
      const offset = selection.focus.offset
      const isBackwards = offset < other.length
      const inlineCode = isBackwards
        ? other.slice(offset)
        : remainder.slice(0, offset - other.length - 1)

      event.preventDefault()

      const anchor = Point.create({
        key: currentTextNode.key,
        path: currentTextNode.path,
        offset: isBackwards ? offset : other.length
      })
      const focus = Point.create({
        key: currentTextNode.key,
        path: currentTextNode.path,
        offset: isBackwards ? other.length + 1 : offset
      })
      const range = Range.create({
        anchor,
        focus
      })

      return change
        .deleteAtRange(range)
        .insertTextByKey(
          currentTextNode.key,
          isBackwards ? offset : other.length,
          inlineCode,
          [Mark.create({ type })]
        )
        .command(change =>
          change.value.marks.forEach(mark => {
            change.removeMark(mark)
          })
        )
    }

    next()
  }

  handleKeyDown = (event, change, next) => {
    // Keyboard shortcuts
    if (keyboardEvent.isMod(event) && event.key === 'b') {
      return change.toggleMark('bold').focus()
    }
    if (keyboardEvent.isMod(event) && event.key === 'i') {
      return change.toggleMark('italic').focus()
    }

    // Markdown shortcuts
    switch (event.key) {
      case ' ':
        return this.handleSpace(event, change)
      case '/':
        return this.handleCommand(event, change)
      case '`':
        return this.handleBackTick(event, change, next)
      case '*':
        return this.handleAsterisk(event, change, next)
      case '_':
        return this.handleUnderscore(event, change, next)
      case 'Backspace':
        return this.handleBackspace(event, change, next)
      case 'Enter':
        return this.handleEnter(event, change, next)
      case 'Tab':
        return this.handleTab(event, change, next)
      case 'Escape':
        this.setState({ emojiMenu: false })
        this.setState({ menu: false })
        return
      default: {
      }
    }
  }

  handleSpace = (event, change) => {
    const { value } = change
    const { selection } = value
    if (selection.isExpanded) return

    const { startBlock } = value
    const { start } = selection
    const chars = startBlock.text.slice(0, start.offset).replace(/\s*/g, '')
    const type = getTypeFromMarkdown(chars)

    if (!type) return
    if (type === 'check-list-item') {
      change.wrapBlock('paragraph')
      change.setBlocks(type)
      change.moveFocusToStartOfNode(startBlock).delete()
      return
    }

    if (type === 'pre') {
      event.preventDefault()
      startBlock.nodes.forEach(node => change.removeNodeByKey(node.key))
      change.insertBlock('pre')
      return
    }

    if (type === 'list-item' && startBlock.type === 'list-item') return
    event.preventDefault()

    if (type === 'hr') {
      change.moveFocusToStartOfNode(startBlock).delete()
      change.insertBlock('hr')
      return
    }

    change.setBlocks(type)

    if (type === 'list-item') {
      change.wrapBlock('bulleted-list')
    }

    change.moveFocusToStartOfNode(startBlock).delete()
    return true
  }

  handleCommand = () => {
    this.setState({ commandMenu: true })
  }

  handlePaste = (event, editor, next) => {
    const { value } = editor
    const { document, startBlock } = value

    const target = getEventRange(event, editor)
    const transfer = getEventTransfer(event)
    const { type, text } = transfer

    if (type === 'text' || type === 'fragment') {
      if (isImageUrl(text)) {
        return editor.command(insertImage, text, target)
      }

      if (isUrl(text)) {
        return editor.command(insertUnfurl, text, target)
      }

      const parent = document.getParent(startBlock.key)
      // We're inside a table and pasting a fragment, for now lets
      // not allow embedded table pasting.
      if (type === 'fragment' && parent.type === 'table_cell') {
        return editor.insertText(text || '')
      }

      return next()
    }

    next()
  }

  handleTab = (event, change, next) => {
    const { value } = change

    event.preventDefault()

    const { document } = value
    const block = value.startBlock
    const parent = document.getParent(block.key)
    const previous = document.getPreviousSibling(block.key)

    if (!parent || parent.type !== 'bulleted-list') {
      return change.insertText('  ')
    }

    // Previous sibling is a single list item, wrap/unwrap current node as list
    if (
      previous &&
      previous.nodes.size === 1 &&
      (previous.type === 'list-item' || previous.type === 'check-list-item')
    ) {
      return event.shiftKey
        ? change.unwrapBlock('bulleted-list')
        : change.wrapBlock('bulleted-list')
    }

    // Previous sibling already is a list, insert into it
    if (previous && previous.type === 'bulleted-list' && !event.shiftKey) {
      return change.moveNodeByKey(block.key, previous.key, previous.nodes.size)
    }

    // Node is head of nested list and parent is still a list, unwrap it
    if (parent && parent.type === 'bulleted-list' && event.shiftKey) {
      return change.unwrapBlock('bulleted-list')
    }
  }

  handleBackspace = (event, change, next) => {
    const { value } = change
    const { selection } = value

    if (selection.isExpanded) {
      return next()
    }

    if (selection.start.offset !== 0) {
      return next()
    }

    const { startBlock } = value
    if (startBlock.type === 'paragraph') {
      return next()
    }

    event.preventDefault()
    change.setBlocks('paragraph')

    if (startBlock.type === 'list-item') {
      return change.unwrapBlock('bulleted-list')
    }

    if (startBlock.type === 'check-list-item') {
      return change.unwrapBlock('paragraph')
    }

    return next()
  }

  handleEnter = (event, change, next) => {
    const { value } = change
    const { selection } = value
    const { start, end, isExpanded } = selection
    if (isExpanded) return

    const { startBlock } = value

    if (startBlock.type === 'pre' || startBlock.type === 'jsx') {
      return change.insertText('\n')
    }

    // Enter was pressed with no content, reset the node to be an empty paragraph
    if (start.offset === 0 && startBlock.text.length === 0) {
      return this.handleBackspace(event, change, next)
    }

    if (end.offset !== startBlock.text.length) {
      // Cursor is mid paragraph, create two paragraphs/items
      if (startBlock.type === 'list-item') {
        return change.splitBlock().setBlocks('list-item')
      } else if (startBlock.type === 'check-list-item') {
        return change.splitBlock().setBlocks({ data: { checked: false } })
      } else {
        return change.splitBlock().setBlocks('paragraph')
      }
    }

    // Continue with check list, ensure checked is set to false
    if (startBlock.type === 'check-list-item') {
      return change.splitBlock().setBlocks({ data: { checked: false } })
    }

    // Started a code/jsx/hr block
    const type = getTypeFromMarkdown(startBlock.text)
    if (type === 'pre' || type === 'jsx') {
      return change
        .setBlocks(type)
        .moveFocusToStartOfNode(startBlock)
        .delete()
    } else if (type === 'hr') {
      return change
        .moveFocusToStartOfNode(startBlock)
        .delete()
        .setBlocks('hr')
        .insertBlock('paragraph')
    } else if (type === 'table') {
      change.moveFocusToStartOfNode(startBlock).delete()
      return change.editor.insertTable()
    }

    if (
      startBlock.type !== 'heading-one' &&
      startBlock.type !== 'heading-two' &&
      startBlock.type !== 'heading-three' &&
      startBlock.type !== 'heading-four' &&
      startBlock.type !== 'heading-five' &&
      startBlock.type !== 'heading-six' &&
      startBlock.type !== 'block-quote'
    ) {
      return next()
    }

    event.preventDefault()
    change.splitBlock().setBlocks('paragraph')
  }

  render() {
    return (
      <div style={{ minHeight: '100vh' }}>
        <Editor
          ref={editor => (this.editor = editor)}
          schema={schema}
          placeholder="Write some MDX..."
          plugins={plugins}
          value={this.state.value}
          onChange={this.handleChange}
          onKeyDown={this.handleKeyDown}
          onPaste={this.handlePaste}
          renderNode={NodeRenderer(this.handleChange)}
          renderMark={MarkComponent}
          renderEditor={(props, _editor, next) => {
            const children = next()

            return (
              <React.Fragment>
                {children}
                <SelectionMenu
                  innerRef={this.selectionMenu}
                  editor={this.editor}
                  forceShow={this.state.selectionMenu}
                  onChange={value => {
                    this.setState({ selectionMenu: false })
                    this.emitChange({ value })
                  }}
                />
              </React.Fragment>
            )
          }}
        />
      </div>
    )
  }
}

export default BlockEditor