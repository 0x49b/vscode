/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { NotebookDiffEditorEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { CellDiffViewModelLayoutChangeEvent, DIFF_CELL_MARGIN } from 'vs/workbench/contrib/notebook/browser/diff/common';
import { NotebookLayoutInfo } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { DiffEditorWidget } from 'vs/editor/browser/widget/diffEditorWidget';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { hash } from 'vs/base/common/hash';
import { format } from 'vs/base/common/jsonFormatter';
import { applyEdits } from 'vs/base/common/jsonEdit';
import { NotebookCellMetadata } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { PrefixSumComputer } from 'vs/editor/common/viewModel/prefixSumComputer';

export enum PropertyFoldingState {
	Expanded,
	Collapsed
}

export abstract class CellDiffViewModelBase extends Disposable {
	public metadataFoldingState: PropertyFoldingState;
	public outputFoldingState: PropertyFoldingState;
	protected _layoutInfoEmitter = new Emitter<CellDiffViewModelLayoutChangeEvent>();
	onDidLayoutChange = this._layoutInfoEmitter.event;

	protected _layoutInfo!: {
		width: number;
		editorHeight: number;
		editorMargin: number;
		metadataStatusHeight: number;
		metadataHeight: number;
		outputStatusHeight: number;
		outputHeight: number;
		bodyMargin: number;
	};

	set outputHeight(height: number) {
		this._layoutInfo.outputHeight = height;
		this._fireLayoutChangeEvent({ outputEditor: true, outputView: true });
	}

	get outputHeight() {
		return this._layoutInfo.outputHeight;
	}

	set outputStatusHeight(height: number) {
		this._layoutInfo.outputStatusHeight = height;
		this._fireLayoutChangeEvent({});
	}

	get outputStatusHeight() {
		return this._layoutInfo.outputStatusHeight;
	}

	set editorHeight(height: number) {
		this._layoutInfo.editorHeight = height;
		this._fireLayoutChangeEvent({ editorHeight: true });
	}

	get editorHeight() {
		return this._layoutInfo.editorHeight;
	}

	set editorMargin(height: number) {
		this._layoutInfo.editorMargin = height;
		this._fireLayoutChangeEvent({});
	}

	get editorMargin() {
		return this._layoutInfo.editorMargin;
	}

	get metadataStatusHeight() {
		return this._layoutInfo.metadataStatusHeight;
	}

	set metadataHeight(height: number) {
		this._layoutInfo.metadataHeight = height;
		this._fireLayoutChangeEvent({ metadataEditor: true });
	}

	get metadataHeight() {
		return this._layoutInfo.metadataHeight;
	}

	get totalHeight() {
		return this._layoutInfo.editorHeight
			+ this._layoutInfo.editorMargin
			+ this._layoutInfo.metadataHeight
			+ this._layoutInfo.metadataStatusHeight
			+ this._layoutInfo.outputHeight
			+ this._layoutInfo.outputStatusHeight
			+ this._layoutInfo.bodyMargin;
	}

	constructor(
		readonly documentTextModel: NotebookTextModel,
		readonly original: NotebookCellTextModel | undefined,
		readonly modified: NotebookCellTextModel | undefined,
		readonly type: 'unchanged' | 'insert' | 'delete' | 'modified',
		readonly editorEventDispatcher: NotebookDiffEditorEventDispatcher
	) {
		super();
		this._layoutInfo = {
			width: 0,
			editorHeight: 0,
			editorMargin: 0,
			metadataHeight: 0,
			metadataStatusHeight: 25,
			outputHeight: 0,
			outputStatusHeight: 25,
			bodyMargin: 32
		};


		this.metadataFoldingState = PropertyFoldingState.Collapsed;
		this.outputFoldingState = PropertyFoldingState.Collapsed;

		this._register(this.editorEventDispatcher.onDidChangeLayout(e => {
			this._layoutInfoEmitter.fire({ outerWidth: true });
		}));
	}
	private _fireLayoutChangeEvent(state: { outerWidth?: boolean, editorHeight?: boolean, metadataEditor?: boolean, outputEditor?: boolean, outputView?: boolean }) {
		this._layoutInfoEmitter.fire(state);
	}

	abstract checkIfOutputsModified(): boolean;
	abstract checkMetadataIfModified(): boolean;
	abstract ensureOutputsTop(): void;
	abstract layoutChange(): void;

	getComputedCellContainerWidth(layoutInfo: NotebookLayoutInfo, diffEditor: boolean, fullWidth: boolean) {
		if (fullWidth) {
			return layoutInfo.width - 2 * DIFF_CELL_MARGIN + (diffEditor ? DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH : 0) - 2;
		}

		return (layoutInfo.width - 2 * DIFF_CELL_MARGIN + (diffEditor ? DiffEditorWidget.ENTIRE_DIFF_OVERVIEW_WIDTH : 0)) / 2 - 18 - 2;
	}
}

export class SideBySideCellDiffViewModel extends CellDiffViewModelBase {
	protected _originalOutputCollection: number[] = [];
	protected _originalOutputsTop: PrefixSumComputer | null = null;
	protected _modifiedOutputCollection: number[] = [];
	protected _modifiedOutputsTop: PrefixSumComputer | null = null;

	constructor(
		readonly documentTextModel: NotebookTextModel,
		readonly original: NotebookCellTextModel,
		readonly modified: NotebookCellTextModel,
		readonly type: 'unchanged' | 'modified',
		readonly editorEventDispatcher: NotebookDiffEditorEventDispatcher
	) {
		super(
			documentTextModel,
			original,
			modified,
			type,
			editorEventDispatcher);

		this.metadataFoldingState = PropertyFoldingState.Collapsed;
		this.outputFoldingState = PropertyFoldingState.Collapsed;

		if (this.checkMetadataIfModified()) {
			this.metadataFoldingState = PropertyFoldingState.Expanded;
		}

		if (this.checkIfOutputsModified()) {
			this.outputFoldingState = PropertyFoldingState.Expanded;
		}

		this._originalOutputCollection = new Array(this.original.outputs.length);
		this._modifiedOutputCollection = new Array(this.modified.outputs.length);
	}

	layoutChange() {
		this.ensureOutputsTop();

		let outputHeight = this.outputFoldingState === PropertyFoldingState.Collapsed ? 0 : this.getOutputTotalHeight();
		this._layoutInfo = {
			width: this._layoutInfo.width,
			editorHeight: this._layoutInfo.editorHeight,
			editorMargin: this._layoutInfo.editorMargin,
			metadataHeight: this._layoutInfo.metadataHeight,
			metadataStatusHeight: this._layoutInfo.metadataStatusHeight,
			outputHeight: outputHeight,
			outputStatusHeight: this._layoutInfo.outputStatusHeight,
			bodyMargin: this._layoutInfo.bodyMargin
		};

		this._layoutInfoEmitter.fire({});
	}

	checkIfOutputsModified() {
		return !this.documentTextModel.transientOptions.transientOutputs && this.type === 'modified' && hash(this.original?.outputs ?? []) !== hash(this.modified?.outputs ?? []);
	}

	checkMetadataIfModified(): boolean {
		return hash(getFormatedMetadataJSON(this.documentTextModel, this.original?.metadata || {}, this.original?.language)) !== hash(getFormatedMetadataJSON(this.documentTextModel, this.modified?.metadata ?? {}, this.modified?.language));
	}

	updateOutputHeight(original: boolean, index: number, height: number) {
		if (original) {
			if (index >= this._originalOutputCollection.length) {
				throw new Error('Output index out of range!');
			}

			this.ensureOriginalOutputsTop();
			this.ensureModifiedOutputsTop();
			this._originalOutputCollection[index] = height;

			if (this._originalOutputsTop!.changeValue(index, height)) {
				this.layoutChange();
			}
		} else {
			if (index >= this._modifiedOutputCollection.length) {
				throw new Error('Output index out of range!');
			}

			this.ensureOriginalOutputsTop();
			this.ensureModifiedOutputsTop();
			this._modifiedOutputCollection[index] = height;

			if (this._modifiedOutputsTop!.changeValue(index, height)) {
				this.layoutChange();
			}
		}
	}

	ensureOriginalOutputsTop() {
		if (!this._originalOutputsTop) {
			const values = new Uint32Array(this._originalOutputCollection.length);
			for (let i = 0; i < this._originalOutputCollection.length; i++) {
				values[i] = this._originalOutputCollection[i];
			}

			this._originalOutputsTop = new PrefixSumComputer(values);
		}
	}

	ensureModifiedOutputsTop() {
		if (!this._modifiedOutputsTop) {
			const values = new Uint32Array(this._modifiedOutputCollection.length);
			for (let i = 0; i < this._modifiedOutputCollection.length; i++) {
				values[i] = this._modifiedOutputCollection[i];
			}

			this._modifiedOutputsTop = new PrefixSumComputer(values);
		}
	}

	getOutputOffsetInContainer(original: boolean, index: number) {
		this.ensureOutputsTop();

		if (original) {
			if (index >= this._originalOutputCollection.length) {
				throw new Error('Output index out of range!');
			}

			return this._originalOutputsTop!.getAccumulatedValue(index - 1);
		} else {
			if (index >= this._modifiedOutputCollection.length) {
				throw new Error('Output index out of range!');
			}

			return this._modifiedOutputsTop!.getAccumulatedValue(index - 1);
		}
	}

	getOutputTotalHeight() {
		this.ensureOutputsTop();

		return Math.max(this._originalOutputsTop?.getTotalValue() ?? 0, this._modifiedOutputsTop?.getTotalValue() ?? 0);
	}

	ensureOutputsTop() {
		this.ensureOriginalOutputsTop();
		this.ensureModifiedOutputsTop();
	}
}

export class SingleSideCellDiffViewModel extends CellDiffViewModelBase {
	protected _outputCollection: number[] = [];
	protected _outputsTop: PrefixSumComputer | null = null;

	get cellTextModel() {
		return this.type === 'insert' ? this.modified : this.original;
	}

	constructor(
		readonly documentTextModel: NotebookTextModel,
		readonly original: NotebookCellTextModel | undefined,
		readonly modified: NotebookCellTextModel | undefined,
		readonly type: 'insert' | 'delete',
		readonly editorEventDispatcher: NotebookDiffEditorEventDispatcher
	) {
		super(documentTextModel, original, modified, type, editorEventDispatcher);
		this._outputCollection = new Array(this.original ? this.original.outputs.length : this.modified!.outputs.length);
	}

	layoutChange() {
		this.ensureOutputsTop();

		let outputHeight = this.outputFoldingState === PropertyFoldingState.Collapsed ? 0 : this.getOutputTotalHeight();
		this._layoutInfo = {
			width: this._layoutInfo.width,
			editorHeight: this._layoutInfo.editorHeight,
			editorMargin: this._layoutInfo.editorMargin,
			metadataHeight: this._layoutInfo.metadataHeight,
			metadataStatusHeight: this._layoutInfo.metadataStatusHeight,
			outputHeight: outputHeight,
			outputStatusHeight: this._layoutInfo.outputStatusHeight,
			bodyMargin: this._layoutInfo.bodyMargin
		};

		this._layoutInfoEmitter.fire({});
	}


	checkIfOutputsModified(): boolean {
		return false;
	}

	checkMetadataIfModified(): boolean {
		return false;
	}

	updateOutputHeight(index: number, height: number) {
		if (index >= this._outputCollection.length) {
			throw new Error('Output index out of range!');
		}

		this.ensureOutputsTop();
		this._outputCollection[index] = height;
		if (this._outputsTop!.changeValue(index, height)) {
			this.layoutChange();
		}
	}

	ensureOutputsTop() {
		if (!this._outputsTop) {
			const values = new Uint32Array(this._outputCollection.length);
			for (let i = 0; i < this._outputCollection.length; i++) {
				values[i] = this._outputCollection[i];
			}

			this._outputsTop = new PrefixSumComputer(values);
		}
	}

	getOutputOffsetInContainer(index: number) {
		this.ensureOutputsTop();

		if (index >= this._outputCollection.length) {
			throw new Error('Output index out of range!');
		}

		return this._outputsTop!.getAccumulatedValue(index - 1);
	}

	getOutputTotalHeight() {
		this.ensureOutputsTop();

		return this._outputsTop?.getTotalValue() ?? 0;
	}
}

export function getFormatedMetadataJSON(documentTextModel: NotebookTextModel, metadata: NotebookCellMetadata, language?: string) {
	let filteredMetadata: { [key: string]: any } = {};

	if (documentTextModel) {
		const transientMetadata = documentTextModel.transientOptions.transientMetadata;

		const keys = new Set([...Object.keys(metadata)]);
		for (let key of keys) {
			if (!(transientMetadata[key as keyof NotebookCellMetadata])
			) {
				filteredMetadata[key] = metadata[key as keyof NotebookCellMetadata];
			}
		}
	} else {
		filteredMetadata = metadata;
	}

	const content = JSON.stringify({
		language,
		...filteredMetadata
	});

	const edits = format(content, undefined, {});
	const metadataSource = applyEdits(content, edits);

	return metadataSource;
}
