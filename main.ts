import { Plugin, PluginSettingTab, Setting, Notice, App, MarkdownView } from "obsidian";
import mermaid from "mermaid";

interface MermaidExporterSettings {
	exportQuality: string;
	defaultExportLocation: string;
	filenameFormat: string;
	exportFormat: string;
}

const DEFAULT_SETTINGS: MermaidExporterSettings = {
	exportQuality: "high",
	defaultExportLocation: "",
	filenameFormat: "{noteName}-{timestamp}",
	exportFormat: "svg"
}

export default class MermaidExporterPlugin extends Plugin {
	settings: MermaidExporterSettings;
	private observer: MutationObserver | null = null;
	private processedDiagrams: Set<HTMLElement> = new Set();

	async onload() {
		await this.loadSettings();

		// Initialize Mermaid.js
		mermaid.initialize({
			startOnLoad: false,
			theme: 'default',
			securityLevel: 'loose',
			fontFamily: 'inherit',
		});

		// This creates an icon in the left ribbon.
		this.addRibbonIcon("download", "Mermaid Exporter", (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice("Mermaid Exporter plugin loaded!");
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new MermaidExporterSettingTab(this.app, this));

		// Initialize Mermaid diagram detection
		this.initializeMermaidDetection();

		// Plugin loaded successfully
		console.log("Mermaid Exporter plugin loaded");
	}

	onunload() {
		// Clean up observer
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}

		// Remove all export buttons
		document.querySelectorAll('.mermaid-export-button').forEach(btn => btn.remove());
		this.processedDiagrams.clear();

		console.log("Mermaid Exporter plugin unloaded");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Initialize MutationObserver to detect Mermaid diagrams
	 */
	private initializeMermaidDetection() {
		// Process existing diagrams on load
		this.processExistingDiagrams();

		// Set up MutationObserver to watch for new Mermaid diagrams
		this.observer = new MutationObserver((mutations) => {
			let shouldProcess = false;
			let shouldCleanup = false;
			
			for (const mutation of mutations) {
				if (mutation.type === 'childList') {
					if (mutation.addedNodes.length > 0) {
						shouldProcess = true;
					}
					if (mutation.removedNodes.length > 0) {
						shouldCleanup = true;
					}
				}
			}

			if (shouldProcess) {
				// Use a small delay to ensure DOM is fully rendered
				setTimeout(() => {
					this.processExistingDiagrams();
				}, 100);
			}

			if (shouldCleanup) {
				// Clean up buttons for removed diagrams
				this.cleanupRemovedDiagrams();
			}
		});

		// Start observing the document body for changes
		this.observer.observe(document.body, {
			childList: true,
			subtree: true
		});

		// Also listen for hover events to catch dynamically appearing "Edit" buttons
		document.addEventListener('mouseover', (e) => {
			const target = e.target as HTMLElement;
			// Check if hovering over a code block area or mermaid diagram
			if (target.closest('pre, .code-block, code.language-mermaid, .mermaid, svg.mermaid')) {
				setTimeout(() => {
					this.processExistingDiagrams();
				}, 150);
			}
		}, true);
	}

	/**
	 * Clean up export buttons for removed diagrams
	 */
	private cleanupRemovedDiagrams() {
		const toRemove: HTMLElement[] = [];
		
		this.processedDiagrams.forEach((element) => {
			if (!document.body.contains(element)) {
				toRemove.push(element);
			}
		});

		toRemove.forEach((element) => {
			this.processedDiagrams.delete(element);
		});

		// Remove orphaned export buttons
		document.querySelectorAll('.mermaid-export-button').forEach((btn) => {
			const mermaidElement = this.findAssociatedMermaidElement(btn as HTMLElement);
			if (!mermaidElement || !document.body.contains(mermaidElement)) {
				btn.remove();
			}
		});
	}

	/**
	 * Find the Mermaid element associated with an export button
	 */
	private findAssociatedMermaidElement(button: HTMLElement): HTMLElement | null {
		let current: HTMLElement | null = button;
		for (let i = 0; i < 10 && current; i++) {
			current = current.parentElement;
			if (!current) break;
			
			if (current.classList.contains('mermaid') ||
			    current.querySelector('code.language-mermaid') ||
			    current.querySelector('.mermaid svg')) {
				return current;
			}
		}
		return null;
	}

	/**
	 * Find and process all existing Mermaid diagrams
	 */
	private processExistingDiagrams() {
		// Find all Mermaid diagram containers
		// Obsidian renders Mermaid diagrams in various ways, so we check multiple selectors
		
		// Strategy 1: Find code blocks with language-mermaid
		const mermaidCodeBlocks = document.querySelectorAll('code.language-mermaid, code[class*="mermaid"]');
		
		// Strategy 2: Find rendered Mermaid SVG elements (these are the actual rendered diagrams)
		const mermaidSvgs = document.querySelectorAll('svg.mermaid, .mermaid svg, svg[id^="mermaid"]');
		
		// Strategy 3: Find Obsidian's rendered preview code blocks (.cm-preview-code-block.cm-lang-mermaid)
		const previewCodeBlocks = document.querySelectorAll('.cm-preview-code-block.cm-lang-mermaid, .cm-embed-block.cm-lang-mermaid, [class*="cm-preview-code-block"][class*="mermaid"]');
		
		// Strategy 4: Find code block containers that contain mermaid
		const codeBlockContainers = document.querySelectorAll('pre code, .code-block');
		const mermaidContainers: HTMLElement[] = [];
		
		codeBlockContainers.forEach((container) => {
			const codeElement = container as HTMLElement;
			const text = codeElement.textContent || '';
			const lang = codeElement.className || '';
			
			// Check if this is a mermaid code block
			if (lang.includes('mermaid') || 
			    (text.trim().startsWith('mermaid') && (text.includes('graph') || text.includes('flowchart')))) {
				mermaidContainers.push(codeElement);
			}
		});

		// Combine all found elements
		const allMermaidElements = new Set<HTMLElement>();
		
		mermaidCodeBlocks.forEach(el => allMermaidElements.add(el as HTMLElement));
		
		// Add preview code blocks directly
		previewCodeBlocks.forEach(el => allMermaidElements.add(el as HTMLElement));
		
		// For rendered SVGs, find their parent container (usually a div or pre)
		mermaidSvgs.forEach(el => {
			// Find the parent container that likely has the edit button
			const parent = el.parentElement;
			if (parent) {
				// Look for the code block wrapper
				const codeBlockWrapper = parent.closest('pre, .code-block, .markdown-preview-section, .cm-preview-code-block, [class*="code"]') as HTMLElement | null;
				if (codeBlockWrapper) {
					allMermaidElements.add(codeBlockWrapper);
				} else {
					allMermaidElements.add(parent);
				}
			}
		});
		
		mermaidContainers.forEach(el => allMermaidElements.add(el));

		// Process each unique Mermaid element
		allMermaidElements.forEach((element) => {
			// Skip if already processed
			if (this.processedDiagrams.has(element)) {
				return;
			}

			// Find the code block action bar (where "Edit this block" button is)
			const actionBar = this.findCodeBlockActionBar(element);
			
			if (actionBar) {
				this.addExportButton(actionBar, element);
				this.processedDiagrams.add(element);
			} else {
				// If no action bar found immediately, try again after a delay
				// (in case buttons are added dynamically on hover)
				setTimeout(() => {
					if (!this.processedDiagrams.has(element)) {
						const actionBar = this.findCodeBlockActionBar(element);
						if (actionBar) {
							this.addExportButton(actionBar, element);
							this.processedDiagrams.add(element);
						} else {
							// Debug: log if we still can't find it
							console.log('Mermaid Exporter: Could not find action bar for element:', element);
						}
					}
				}, 500);
			}
		});
	}

	/**
	 * Find the code block action bar containing the "Edit this block" button
	 */
	private findCodeBlockActionBar(mermaidElement: HTMLElement): HTMLElement | null {
		// Strategy 1: Look for the .edit-block-button specifically (most reliable)
		const codeBlockContainer = mermaidElement.closest('pre, .code-block, .cm-preview-code-block, .cm-embed-block, [class*="code"], .markdown-preview-section') as HTMLElement | null;
		if (codeBlockContainer) {
			const editButton = codeBlockContainer.querySelector('.edit-block-button') as HTMLElement | null;
			if (editButton && editButton.parentElement) {
				return editButton.parentElement;
			}
		}

		// Strategy 2: Look for the code block container and its action bar
		// In Obsidian, code blocks are typically wrapped in a container with action buttons
		let current: HTMLElement | null = mermaidElement;
		
		// Traverse up to find code block container
		for (let i = 0; i < 10 && current; i++) {
			current = current.parentElement;
			if (!current) break;

			// Look for .edit-block-button in this container
			const editButton = current.querySelector('.edit-block-button') as HTMLElement | null;
			if (editButton && editButton.parentElement) {
				return editButton.parentElement;
			}

			// Check if this is a code block container
			if (current.classList.contains('code-block-wrapper') ||
			    current.classList.contains('code-block') ||
			    current.classList.contains('cm-preview-code-block') ||
			    current.classList.contains('cm-embed-block') ||
			    current.hasAttribute('data-code-block')) {
				
				// Look for action bar/flair within this container
				const actionBar = current.querySelector('.code-block-flair, .code-block-actions, .code-block-edit-button');
				if (actionBar) {
					return actionBar as HTMLElement;
				}
				
				// If no action bar found, create one or use the container itself
				return current;
			}
		}

		// Strategy 3: Look for "Edit this block" button by aria-label (fallback)
		const editButtonByAria = document.querySelector('.edit-block-button[aria-label*="Edit"], div[aria-label="Edit this block"]') as HTMLElement | null;
		if (editButtonByAria) {
			// Check if this button is related to our mermaid element
			const btnContainer = editButtonByAria.closest('pre, .code-block, .cm-preview-code-block, .cm-embed-block, [class*="code"], .markdown-preview-section') as HTMLElement | null;
			const mermaidContainer = mermaidElement.closest('pre, .code-block, .cm-preview-code-block, .cm-embed-block, [class*="code"], .markdown-preview-section') as HTMLElement | null;
			
			if (btnContainer === mermaidContainer && editButtonByAria.parentElement) {
				return editButtonByAria.parentElement;
			}
		}

		// Strategy 4: Create a wrapper if no action bar exists
		// This ensures we can still add the button
		const wrapper = mermaidElement.closest('pre, .code-block, .cm-preview-code-block, .cm-embed-block') as HTMLElement | null;
		if (wrapper) {
			// Create a simple container for the button
			let actionBar = wrapper.querySelector('.mermaid-export-container') as HTMLElement;
			if (!actionBar) {
				actionBar = document.createElement('div');
				actionBar.className = 'mermaid-export-container';
				actionBar.style.cssText = 'position: absolute; top: 4px; right: 4px; display: flex; gap: 4px;';
				wrapper.style.position = 'relative';
				wrapper.appendChild(actionBar);
			}
			return actionBar;
		}

		return null;
	}

	/**
	 * Create and add export button to the action bar
	 */
	private addExportButton(actionBar: HTMLElement, mermaidElement: HTMLElement) {
		// Check if button already exists in this action bar
		if (actionBar.querySelector('.mermaid-export-button')) {
			return;
		}

		// Create export button
		const exportButton = document.createElement('button');
		exportButton.className = 'mermaid-export-button';
		exportButton.setAttribute('aria-label', 'Export Mermaid diagram as SVG');
		exportButton.setAttribute('title', 'Export as SVG');
		
		// Add SVG icon (download/export symbol)
		exportButton.innerHTML = `
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
				<polyline points="7 10 12 15 17 10"></polyline>
				<line x1="12" y1="15" x2="12" y2="3"></line>
			</svg>
		`;

		// Style the button to match Obsidian's UI
		exportButton.style.cssText = `
			display: inline-flex;
			align-items: center;
			justify-content: center;
			padding: 4px 8px;
			margin: 2px;
			border: none;
			background: transparent;
			color: var(--text-muted);
			cursor: pointer;
			border-radius: 4px;
			transition: background-color 0.2s, color 0.2s;
			opacity: 0.8;
		`;

		// Hover effects
		exportButton.addEventListener('mouseenter', () => {
			exportButton.style.backgroundColor = 'var(--background-modifier-hover)';
			exportButton.style.color = 'var(--text-normal)';
			exportButton.style.opacity = '1';
		});

		exportButton.addEventListener('mouseleave', () => {
			exportButton.style.backgroundColor = 'transparent';
			exportButton.style.color = 'var(--text-muted)';
			exportButton.style.opacity = '0.8';
		});

		// Click handler - triggers SVG export
		exportButton.addEventListener('click', (e) => {
			e.stopPropagation();
			e.preventDefault();
			this.handleExportClick(mermaidElement);
		});

		// Store reference to mermaid element for cleanup
		exportButton.setAttribute('data-mermaid-element', 'true');

		// Insert button after "Edit this block" button or at the end of action bar
		const editButton = actionBar.querySelector('.edit-block-button, button[aria-label*="Edit"], button[title*="Edit"], a[aria-label*="Edit"], div[aria-label="Edit this block"]');
		if (editButton) {
			// Insert right after the edit button
			if (editButton.nextSibling) {
				actionBar.insertBefore(exportButton, editButton.nextSibling);
			} else {
				actionBar.appendChild(exportButton);
			}
		} else {
			// If no edit button found, add at the beginning
			if (actionBar.firstChild) {
				actionBar.insertBefore(exportButton, actionBar.firstChild);
			} else {
				actionBar.appendChild(exportButton);
			}
		}
	}

	/**
	 * Handle export button click - implements Phase 3 SVG export functionality with format support
	 */
	private async handleExportClick(mermaidElement: HTMLElement) {
		try {
			// Show loading notice
			const loadingNotice = new Notice("Exporting Mermaid diagram...", 0);

			// Extract Mermaid diagram source code
			const mermaidCode = this.extractMermaidCode(mermaidElement);
			if (!mermaidCode) {
				loadingNotice.hide();
				new Notice("Error: Could not find Mermaid diagram source code", 5000);
				console.error("Mermaid Exporter: Could not extract Mermaid code from element:", mermaidElement);
				return;
			}

			// Validate Mermaid code
			if (!this.validateMermaidCode(mermaidCode)) {
				loadingNotice.hide();
				new Notice("Error: Invalid Mermaid diagram code", 5000);
				console.error("Mermaid Exporter: Invalid Mermaid code:", mermaidCode);
				return;
			}

			// Render Mermaid diagram to SVG
			const svgContent = await this.renderMermaidToSvg(mermaidCode);
			if (!svgContent) {
				loadingNotice.hide();
				new Notice("Error: Failed to render Mermaid diagram", 5000);
				console.error("Mermaid Exporter: Failed to render Mermaid diagram");
				return;
			}

			// Generate high-resolution SVG
			const highQualitySvg = this.generateHighQualitySvg(svgContent);

			// Generate filename based on format
			const filename = this.generateFilename();
			const exportFormat = this.settings.exportFormat || 'svg';

			// Export based on format setting
			if (exportFormat === 'svg') {
				// Download SVG directly
				await this.downloadFile(highQualitySvg, filename, 'image/svg+xml;charset=utf-8');
			} else if (exportFormat === 'png' || exportFormat === 'jpeg') {
				// Convert SVG to raster format
				await this.convertSvgToRaster(highQualitySvg, filename, exportFormat);
			} else {
				// Fallback to SVG
				await this.downloadFile(highQualitySvg, filename, 'image/svg+xml;charset=utf-8');
			}

			loadingNotice.hide();
			new Notice(`Successfully exported: ${filename}`, 3000);
			console.log("Mermaid Exporter: Successfully exported diagram:", filename);

		} catch (error) {
			new Notice(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 5000);
			console.error("Mermaid Exporter: Export error:", error);
		}
	}

	/**
	 * Extract Mermaid diagram source code from the code block
	 */
	private extractMermaidCode(mermaidElement: HTMLElement): string | null {
		// Strategy 1: Check if this is a rendered preview block (.cm-preview-code-block)
		// In Obsidian, rendered code blocks have the source code stored in a data attribute or nearby
		if (mermaidElement.classList.contains('cm-preview-code-block') || 
		    mermaidElement.classList.contains('cm-embed-block')) {
			
			// Look for the source code block in the editor
			// Obsidian stores the code in a nearby element or we need to find the corresponding source
			const codeBlock = mermaidElement.querySelector('code.language-mermaid, code[class*="mermaid"]') as HTMLElement | null;
			if (codeBlock) {
				const code = codeBlock.textContent || codeBlock.innerText;
				if (code && code.trim().length > 0) {
					return code.trim();
				}
			}

			// Try to find the source code block by traversing up to find the editor container
			// and then looking for the corresponding source code block
			const editorContainer = mermaidElement.closest('.cm-editor, .markdown-source-view, .markdown-preview-view');
			if (editorContainer) {
				// Look for code blocks with mermaid class in the same container
				const sourceCodeBlocks = editorContainer.querySelectorAll('code.language-mermaid, code[class*="mermaid"]');
				for (const codeBlock of Array.from(sourceCodeBlocks)) {
					const code = (codeBlock as HTMLElement).textContent || (codeBlock as HTMLElement).innerText;
					if (code && code.trim().length > 0) {
						// Verify it's a mermaid diagram
						if (this.validateMermaidCode(code.trim())) {
							return code.trim();
						}
					}
				}
			}

			// Try to extract from data attributes (some Obsidian versions store code here)
			const dataCode = mermaidElement.getAttribute('data-code') || 
			                 mermaidElement.getAttribute('data-mermaid-code') ||
			                 mermaidElement.getAttribute('data-source');
			if (dataCode && dataCode.trim().length > 0) {
				return dataCode.trim();
			}
		}

		// Strategy 2: Find code element with Mermaid code directly in the element or children
		const codeElement = mermaidElement.querySelector('code.language-mermaid, code[class*="mermaid"]') as HTMLElement | null;
		if (codeElement) {
			const code = codeElement.textContent || codeElement.innerText;
			if (code && code.trim().length > 0) {
				return code.trim();
			}
		}

		// Strategy 3: Look for pre > code structure
		const preElement = mermaidElement.closest('pre');
		if (preElement) {
			const codeInPre = preElement.querySelector('code') as HTMLElement | null;
			if (codeInPre) {
				const code = codeInPre.textContent || codeInPre.innerText;
				if (code && (code.includes('graph') || code.includes('flowchart') || code.includes('sequenceDiagram') || 
				             code.includes('classDiagram') || code.includes('stateDiagram') || code.includes('erDiagram') ||
				             code.includes('gantt') || code.includes('pie') || code.includes('gitgraph') ||
				             code.includes('journey') || code.includes('requirement') || code.includes('C4Context'))) {
					return code.trim();
				}
			}
		}

		// Strategy 4: Check if element itself contains the code
		if (mermaidElement.tagName === 'CODE' || mermaidElement.classList.contains('language-mermaid')) {
			const code = mermaidElement.textContent || mermaidElement.innerText;
			if (code && code.trim().length > 0) {
				return code.trim();
			}
		}

		// Strategy 5: Try to find the source from the rendered SVG's parent container
		const svgElement = mermaidElement.querySelector('svg.mermaid, .mermaid svg, svg[id^="mermaid"]');
		if (svgElement) {
			// Look for the code block that contains this SVG
			const container = svgElement.closest('pre, .code-block, .markdown-preview-section, .cm-preview-code-block');
			if (container) {
				// First try to find code element in the container
				const codeEl = container.querySelector('code.language-mermaid, code[class*="mermaid"]') as HTMLElement | null;
				if (codeEl) {
					const code = codeEl.textContent || codeEl.innerText;
					if (code && code.trim().length > 0) {
						return code.trim();
					}
				}

				// If that fails, try to find the corresponding source code block in the editor
				const editorView = container.closest('.cm-editor, .markdown-source-view');
				if (editorView) {
					// Find all mermaid code blocks and try to match by position or content
					const allMermaidCodes = editorView.querySelectorAll('code.language-mermaid, code[class*="mermaid"]');
					for (const codeBlock of Array.from(allMermaidCodes)) {
						const code = (codeBlock as HTMLElement).textContent || (codeBlock as HTMLElement).innerText;
						if (code && code.trim().length > 0 && this.validateMermaidCode(code.trim())) {
							return code.trim();
						}
					}
				}
			}
		}

		// Strategy 6: Try to get code from Obsidian's active editor using the API
		try {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				const editor = (activeView as any).editor;
				if (editor && typeof editor.getValue === 'function') {
					const content = editor.getValue();
					// Find mermaid code blocks in the content using regex
					const mermaidRegex = /```mermaid\s*\n([\s\S]*?)```/g;
					let match;
					while ((match = mermaidRegex.exec(content)) !== null) {
						const code = match[1].trim();
						if (code && this.validateMermaidCode(code)) {
							// Try to match this code block to our element by checking if it's in the visible area
							// This is a heuristic - we'll return the first valid mermaid code we find
							// In most cases, there's only one mermaid diagram visible at a time
							return code;
						}
					}
				}
			}
		} catch (e) {
			// If API access fails, continue to next strategy
			console.log('Mermaid Exporter: Could not access editor API:', e);
		}

		// Strategy 7: Last resort - search the entire document for mermaid code blocks
		// This is less ideal but might work if the element structure is unusual
		const allMermaidCodes = document.querySelectorAll('code.language-mermaid, code[class*="mermaid"]');
		for (const codeBlock of Array.from(allMermaidCodes)) {
			const code = (codeBlock as HTMLElement).textContent || (codeBlock as HTMLElement).innerText;
			if (code && code.trim().length > 0 && this.validateMermaidCode(code.trim())) {
				// Check if this code block is near our mermaid element
				const codeContainer = (codeBlock as HTMLElement).closest('pre, .code-block, .cm-preview-code-block');
				if (codeContainer && (mermaidElement.contains(codeContainer) || codeContainer.contains(mermaidElement) || 
				    mermaidElement.closest('pre, .code-block, .cm-preview-code-block') === codeContainer)) {
					return code.trim();
				}
			}
		}

		return null;
	}

	/**
	 * Validate that the code is a valid Mermaid diagram
	 */
	private validateMermaidCode(code: string): boolean {
		if (!code || code.trim().length === 0) {
			return false;
		}

		const trimmed = code.trim().toLowerCase();
		
		// Check for common Mermaid diagram type keywords
		const mermaidKeywords = [
			'graph', 'flowchart', 'sequencediagram', 'classdiagram', 'statediagram',
			'erdiagram', 'gantt', 'pie', 'gitgraph', 'journey', 'requirement',
			'c4context', 'c4container', 'c4component', 'mindmap', 'timeline',
			'sankey-beta', 'quadrantchart'
		];

		return mermaidKeywords.some(keyword => trimmed.includes(keyword));
	}

	/**
	 * Render Mermaid diagram to SVG using Mermaid.js
	 */
	private async renderMermaidToSvg(mermaidCode: string): Promise<string | null> {
		try {
			// Create a unique ID for this diagram
			const diagramId = `mermaid-export-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

			// Create a temporary container that Mermaid can use for rendering
			// The container must be in the DOM and visible for getBBox() to work
			const tempContainer = document.createElement('div');
			tempContainer.id = diagramId;
			tempContainer.className = 'mermaid';
			
			// Set up the container with proper dimensions and visibility
			// Must be visible (not hidden) for getBBox() to work, but positioned off-screen
			// Using display: block instead of fixed positioning to ensure proper rendering
			tempContainer.style.cssText = `
				position: absolute;
				left: 0;
				top: 0;
				width: 2000px;
				height: 2000px;
				overflow: visible;
				visibility: visible;
				opacity: 1;
				display: block;
				pointer-events: none;
				z-index: -9999;
			`;
			
			// Create a wrapper to ensure proper rendering context
			const wrapper = document.createElement('div');
			wrapper.style.cssText = `
				position: fixed;
				left: -10000px;
				top: -10000px;
				width: 2000px;
				height: 2000px;
				overflow: visible;
				visibility: visible;
				opacity: 1;
				display: block;
			`;
			wrapper.appendChild(tempContainer);
			
			// Append to body so it's in the DOM
			document.body.appendChild(wrapper);

			try {
				// Wait for the container to be fully in the DOM and rendered
				// Use requestAnimationFrame to ensure the browser has rendered the element
				await new Promise(resolve => requestAnimationFrame(resolve));
				await new Promise(resolve => requestAnimationFrame(resolve));
				await new Promise(resolve => setTimeout(resolve, 50));

				// Render using Mermaid - it will create an SVG internally
				// The render method needs the container to be in the DOM for bounding box calculations
				const result = await mermaid.render(diagramId, mermaidCode);
				
				// Wait for SVG to be fully rendered before cleanup
				// This ensures getBBox() has access to the rendered SVG
				const svgElement = tempContainer.querySelector('svg');
				if (svgElement) {
					// Force a reflow to ensure the SVG is fully rendered
					// Access parent element's layout properties to trigger reflow
					void tempContainer.offsetHeight;
					await new Promise(resolve => requestAnimationFrame(resolve));
				}
				
				// Clean up temporary container
				if (document.body.contains(wrapper)) {
					document.body.removeChild(wrapper);
				}

				if (!result || !result.svg || result.svg.trim().length === 0) {
					throw new Error("Rendered SVG is empty");
				}

				return result.svg;
			} catch (renderError) {
				// Clean up on error
				if (document.body.contains(wrapper)) {
					document.body.removeChild(wrapper);
				}
				throw renderError;
			}
		} catch (error) {
			console.error("Mermaid Exporter: Rendering error:", error);
			if (error instanceof Error) {
				console.error("Error details:", error.message, error.stack);
			}
			return null;
		}
	}

	/**
	 * Generate high-resolution SVG with proper viewBox and scaling
	 */
	private generateHighQualitySvg(svgContent: string): string {
		// Parse the SVG
		const parser = new DOMParser();
		const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
		const svgElement = svgDoc.documentElement;

		// Check for parsing errors
		const parserError = svgDoc.querySelector('parsererror');
		if (parserError) {
			console.warn("Mermaid Exporter: SVG parsing warning, using original content");
			return svgContent;
		}

		// Get current dimensions
		const currentWidth = svgElement.getAttribute('width');
		const currentHeight = svgElement.getAttribute('height');
		const viewBox = svgElement.getAttribute('viewBox');

		// Ensure viewBox is set for proper scaling
		if (!viewBox && currentWidth && currentHeight) {
			svgElement.setAttribute('viewBox', `0 0 ${currentWidth} ${currentHeight}`);
		}

		// Remove fixed width/height to allow scaling while preserving aspect ratio
		// Keep viewBox for proper rendering
		if (this.settings.exportQuality === 'maximum' || this.settings.exportQuality === 'high') {
			// For high quality, keep dimensions but ensure viewBox is set
			if (!svgElement.getAttribute('viewBox') && currentWidth && currentHeight) {
				svgElement.setAttribute('viewBox', `0 0 ${currentWidth} ${currentHeight}`);
			}
		} else if (this.settings.exportQuality === 'medium') {
			// For medium quality, we can optimize slightly but still maintain quality
			if (!svgElement.getAttribute('viewBox') && currentWidth && currentHeight) {
				svgElement.setAttribute('viewBox', `0 0 ${currentWidth} ${currentHeight}`);
			}
		}

		// Ensure SVG has proper namespace
		if (!svgElement.getAttribute('xmlns')) {
			svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
		}
		if (!svgElement.getAttribute('xmlns:xlink')) {
			svgElement.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
		}

		// Serialize back to string
		const serializer = new XMLSerializer();
		return serializer.serializeToString(svgElement);
	}

	/**
	 * Generate appropriate filename for the exported file using the format template
	 */
	private generateFilename(): string {
		const activeFile = this.app.workspace.getActiveFile();
		const now = new Date();
		
		// Get note name
		const noteName = activeFile ? activeFile.basename : 'mermaid-diagram';
		
		// Generate timestamp components
		const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
		const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
		const time = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
		
		// Get format template from settings
		let filename = this.settings.filenameFormat || DEFAULT_SETTINGS.filenameFormat;
		
		// Replace placeholders
		filename = filename.replace(/{noteName}/g, noteName);
		filename = filename.replace(/{timestamp}/g, timestamp);
		filename = filename.replace(/{date}/g, date);
		filename = filename.replace(/{time}/g, time);
		
		// Add file extension based on export format
		const extension = this.settings.exportFormat || 'svg';
		if (!filename.endsWith(`.${extension}`)) {
			filename += `.${extension}`;
		}
		
		return filename;
	}

	/**
	 * Download file to user's device or save to vault (generic method)
	 */
	private async downloadFile(content: string | Blob, filename: string, mimeType?: string): Promise<void> {
		try {
			// Create blob
			const blob = content instanceof Blob 
				? content 
				: new Blob([content], { type: mimeType || 'application/octet-stream' });

			// If default export location is set, try to save to vault
			if (this.settings.defaultExportLocation && this.settings.defaultExportLocation.trim()) {
				try {
					await this.saveToVault(blob, filename);
					return;
				} catch (vaultError) {
					// If vault save fails, fall back to browser download
					console.warn("Mermaid Exporter: Failed to save to vault, falling back to browser download:", vaultError);
					new Notice("Could not save to vault location, using browser download instead", 3000);
				}
			}

			// Browser download fallback
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = filename;
			link.style.display = 'none';

			// Trigger download
			document.body.appendChild(link);
			link.click();

			// Clean up
			setTimeout(() => {
				document.body.removeChild(link);
				URL.revokeObjectURL(url);
			}, 100);
		} catch (error) {
			console.error("Mermaid Exporter: Download error:", error);
			throw new Error(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * Save file to Obsidian vault at the specified location
	 */
	private async saveToVault(blob: Blob, filename: string): Promise<void> {
		const exportPath = this.settings.defaultExportLocation.trim();
		
		// Normalize path (remove leading/trailing slashes, ensure it starts correctly)
		let normalizedPath = exportPath.replace(/^\/+|\/+$/g, '');
		if (normalizedPath && !normalizedPath.endsWith('/')) {
			normalizedPath += '/';
		}
		
		const fullPath = normalizedPath + filename;

		// Convert blob to array buffer for Obsidian's createBinary method
		const arrayBuffer = await blob.arrayBuffer();

		// Check if directory exists, create if it doesn't
		const vault = this.app.vault;
		const dirPath = normalizedPath || '';
		
		if (dirPath) {
			// Check if directory exists
			const dirExists = await vault.adapter.exists(dirPath);
			if (!dirExists) {
				// Create directory using Obsidian API
				// createFolder should handle creating parent directories
				try {
					await vault.createFolder(dirPath);
				} catch (folderError) {
					// If createFolder fails, try creating parent directories manually
					const parts = dirPath.split('/').filter(p => p);
					let currentPath = '';
					for (const part of parts) {
						currentPath = currentPath ? `${currentPath}/${part}` : part;
						const exists = await vault.adapter.exists(currentPath);
						if (!exists) {
							await vault.createFolder(currentPath);
						}
					}
				}
			}
		}

		// Write file to vault using Obsidian's createBinary method
		await vault.createBinary(fullPath, arrayBuffer);
	}

	/**
	 * Convert SVG to PNG or JPEG raster format
	 */
	private async convertSvgToRaster(svgContent: string, filename: string, format: 'png' | 'jpeg'): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				// Parse SVG to get dimensions
				const parser = new DOMParser();
				const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
				const svgElement = svgDoc.documentElement;

				// Get SVG dimensions
				const viewBox = svgElement.getAttribute('viewBox');
				let width = parseFloat(svgElement.getAttribute('width') || '800');
				let height = parseFloat(svgElement.getAttribute('height') || '600');

				// If viewBox exists, use it for dimensions
				if (viewBox) {
					const parts = viewBox.split(/\s+/);
					if (parts.length >= 4) {
						width = parseFloat(parts[2]);
						height = parseFloat(parts[3]);
					}
				}

				// Apply quality scaling
				const qualityMultiplier = this.getQualityMultiplier();
				width = Math.round(width * qualityMultiplier);
				height = Math.round(height * qualityMultiplier);

				// Create image from SVG using data URL to avoid tainted canvas
				const img = new Image();
				
				// Convert SVG to data URL (this avoids the tainted canvas issue)
				const svgBase64 = btoa(unescape(encodeURIComponent(svgContent)));
				const dataUrl = `data:image/svg+xml;base64,${svgBase64}`;

				img.onload = () => {
					try {
						// Create canvas
						const canvas = document.createElement('canvas');
						canvas.width = width;
						canvas.height = height;
						const ctx = canvas.getContext('2d');

						if (!ctx) {
							throw new Error('Could not get canvas context');
						}

						// Draw image to canvas
						ctx.drawImage(img, 0, 0, width, height);

						// Convert canvas to blob
						canvas.toBlob(
							async (blob) => {
								if (blob) {
									try {
										await this.downloadFile(blob, filename, format === 'png' ? 'image/png' : 'image/jpeg');
										resolve();
									} catch (error) {
										reject(error);
									}
								} else {
									reject(new Error('Failed to convert canvas to blob'));
								}
							},
							format === 'png' ? 'image/png' : 'image/jpeg',
							format === 'jpeg' ? 0.92 : undefined // JPEG quality (0.92 = 92%)
						);
					} catch (error) {
						reject(error);
					}
				};

				img.onerror = () => {
					reject(new Error('Failed to load SVG image'));
				};

				img.src = dataUrl;
			} catch (error) {
				reject(error);
			}
		});
	}

	/**
	 * Get quality multiplier based on export quality setting
	 */
	private getQualityMultiplier(): number {
		switch (this.settings.exportQuality) {
			case 'low':
				return 1.0;
			case 'medium':
				return 1.5;
			case 'high':
				return 2.0;
			case 'maximum':
				return 3.0;
			default:
				return 2.0;
		}
	}
}

class MermaidExporterSettingTab extends PluginSettingTab {
	plugin: MermaidExporterPlugin;

	constructor(app: App, plugin: MermaidExporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Mermaid Exporter Settings" });

		// Export Quality Setting
		new Setting(containerEl)
			.setName("Export Quality")
			.setDesc("Quality/resolution setting for exported diagrams. Higher quality produces larger files but better visual fidelity.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("low", "Low (Smaller file size, lower resolution)")
					.addOption("medium", "Medium (Balanced quality and size)")
					.addOption("high", "High (Recommended, good quality)")
					.addOption("maximum", "Maximum (Best quality, largest file size)")
					.setValue(this.plugin.settings.exportQuality)
					.onChange(async (value) => {
						this.plugin.settings.exportQuality = value;
						await this.plugin.saveSettings();
					})
			);

		// Export Format Setting
		new Setting(containerEl)
			.setName("Export Format")
			.setDesc("File format for exported diagrams. SVG is recommended for scalability, PNG/JPEG for raster images.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("svg", "SVG (Scalable Vector Graphics)")
					.addOption("png", "PNG (Portable Network Graphics)")
					.addOption("jpeg", "JPEG (Joint Photographic Experts Group)")
					.setValue(this.plugin.settings.exportFormat)
					.onChange(async (value) => {
						this.plugin.settings.exportFormat = value;
						await this.plugin.saveSettings();
					})
			);

		// Default Export Location Setting
		new Setting(containerEl)
			.setName("Default Export Location")
			.setDesc("Default folder path in your vault where exported diagrams will be saved. Leave empty to use browser's default download location.")
			.addText((text) =>
				text
					.setPlaceholder("e.g., Exports/Mermaid Diagrams")
					.setValue(this.plugin.settings.defaultExportLocation)
					.onChange(async (value) => {
						this.plugin.settings.defaultExportLocation = value.trim();
						await this.plugin.saveSettings();
					})
			);

		// Filename Format Setting
		new Setting(containerEl)
			.setName("Filename Format")
			.setDesc("Template for exported filenames. Available placeholders: {noteName}, {timestamp}, {date}, {time}. Example: {noteName}-{timestamp}")
			.addText((text) =>
				text
					.setPlaceholder("{noteName}-{timestamp}")
					.setValue(this.plugin.settings.filenameFormat)
					.onChange(async (value) => {
						this.plugin.settings.filenameFormat = value.trim() || DEFAULT_SETTINGS.filenameFormat;
						await this.plugin.saveSettings();
					})
			);

		// Add a note about file size estimation
		const infoEl = containerEl.createDiv("setting-item-description");
		infoEl.style.marginTop = "20px";
		infoEl.style.padding = "10px";
		infoEl.style.backgroundColor = "var(--background-secondary)";
		infoEl.style.borderRadius = "4px";
		infoEl.innerHTML = `
			<strong>Note:</strong> File size depends on diagram complexity and quality setting. 
			SVG format typically produces smaller files for simple diagrams, while PNG/JPEG may be better for complex diagrams with many elements.
		`;
	}
}

