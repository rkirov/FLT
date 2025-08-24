/**
 * This file will be loaded in a browser. It will read the graph from a json and 
 * visualize it using d3.js.
 */

// Declare d3 as global variable (will be loaded from CDN)
declare const d3: any;

interface GraphCommand {
    type: string;
    body?: string;
}

interface GraphRawBlock {
    type: string;
    rawText: string;
    commands: GraphCommand[];
    fileName: string;
    immediatePrevious: GraphRawBlock | null;
}

interface GraphBaseNode {
    id: string;
    type: 'definition' | 'theorem';
    fileName: string;
    rawText: string;
    dependencies: { id: string; type: 'definition' | 'theorem' }[];
}

interface GraphDefinitionNode extends GraphBaseNode {
    type: 'definition';
    leanDone: boolean;
}

interface GraphTheoremNode extends GraphBaseNode {
    type: 'theorem';
    statementLeanDone: boolean;
    proofLeanDone: boolean;
    proofText?: string;
}

type GraphNode = GraphDefinitionNode | GraphTheoremNode;

interface D3Node {
    id: string;
    type: 'definition' | 'theorem';
    leanDone: boolean;
    statementLeanDone?: boolean;
    proofLeanDone?: boolean;
    fileName: string;
    x?: number;
    y?: number;
    fx?: number;
    fy?: number;
}

interface D3Link {
    source: string;
    target: string;
}

class DependencyGraphVisualizer {
    private svg: any;
    private width: number;
    private height: number;
    private simulation: any;
    private originalNodes: GraphNode[] = [];

    constructor(containerId: string) {
        this.width = 1200;
        this.height = 800;
        
        this.svg = d3.select(`#${containerId}`)
            .append('svg')
            .attr('width', this.width)
            .attr('height', this.height);

        // Add zoom behavior
        const zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on('zoom', (event: any) => {
                this.svg.select('g').attr('transform', event.transform);
            });

        this.svg.call(zoom);

        // Create main group for all elements
        this.svg.append('g');
    }

    private getNodeColor(node: D3Node): string {
        if (node.type === 'definition') {
            return node.leanDone ? '#90EE90' : '#F08080';
        } else {
            if (node.statementLeanDone && node.proofLeanDone) {
                return '#90EE90'; // Light green
            } else if (node.statementLeanDone || node.proofLeanDone) {
                return '#FFFFE0'; // Light yellow
            } else {
                return '#F08080'; // Light coral
            }
        }
    }

    private getNodeStroke(node: D3Node): string {
        if (node.type === 'definition') {
            return node.leanDone ? '#006400' : '#8B0000';
        } else {
            if (node.statementLeanDone && node.proofLeanDone) {
                return '#006400'; // Dark green
            } else if (node.statementLeanDone || node.proofLeanDone) {
                return '#FFA500'; // Orange
            } else {
                return '#8B0000'; // Dark red
            }
        }
    }

    private getNodeShape(node: D3Node): string {
        return node.type === 'definition' ? 'rect' : 'circle';
    }

    private getNodeLabel(node: D3Node): string {
        let label = node.id;
        if (node.type === 'theorem') {
            const statusParts = [];
            if (node.statementLeanDone) statusParts.push('stmt✓');
            if (node.proofLeanDone) statusParts.push('proof✓');
            if (statusParts.length > 0) {
                label += ` (${statusParts.join(', ')})`;
            } else {
                label += ' (no Lean)';
            }
        } else {
            if (node.leanDone) {
                label += ' (Lean ✓)';
            } else {
                label += ' (no Lean)';
            }
        }
        return label;
    }

    public async loadAndVisualize(jsonPath: string) {
        try {
            const response = await fetch(jsonPath);
            const nodes: GraphNode[] = await response.json();
            this.originalNodes = nodes;
            this.processAndVisualize(nodes);
        } catch (error) {
            console.error('Error loading dependency graph:', error);
            document.getElementById('error')!.textContent = 'Error loading dependency graph. Make sure dependency_graph.json exists.';
        }
    }

    public loadEmbeddedData(nodes: GraphNode[]) {
        this.originalNodes = nodes;
        this.processAndVisualize(nodes);
    }

    private processAndVisualize(nodes: GraphNode[]) {
        // Convert to D3 format
        const d3Nodes: D3Node[] = nodes.map(node => ({
            id: node.id,
            type: node.type,
            leanDone: node.type === 'definition' ? node.leanDone : 
                     (node.statementLeanDone && node.proofLeanDone),
            statementLeanDone: node.type === 'theorem' ? node.statementLeanDone : undefined,
            proofLeanDone: node.type === 'theorem' ? node.proofLeanDone : undefined,
            fileName: node.fileName
        }));

        const d3Links: D3Link[] = [];
        nodes.forEach(node => {
            node.dependencies.forEach((dep: any) => {
                d3Links.push({
                    source: dep.id,
                    target: node.id
                });
            });
        });

        this.visualize(d3Nodes, d3Links);
    }

    private visualize(nodes: D3Node[], links: D3Link[]) {
        const g = this.svg.select('g');

        // Create force simulation
        this.simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links)
                .id((d: any) => d.id)
                .distance(100))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(this.width / 2, this.height / 2))
            .force('collision', d3.forceCollide().radius(30));

        // Create arrow markers for links
        this.svg.append('defs').selectAll('marker')
            .data(['arrow'])
            .enter().append('marker')
            .attr('id', 'arrow')
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 25)
            .attr('refY', 0)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', '#999');

        // Create links
        const link = g.append('g')
            .attr('class', 'links')
            .selectAll('line')
            .data(links)
            .enter().append('line')
            .attr('stroke', '#999')
            .attr('stroke-opacity', 0.6)
            .attr('stroke-width', 2)
            .attr('marker-end', 'url(#arrow)');

        // Create nodes
        const node = g.append('g')
            .attr('class', 'nodes')
            .selectAll('g')
            .data(nodes)
            .enter().append('g')
            .attr('class', 'node')
            .style('cursor', 'pointer')
            .on('click', (event: any, d: any) => this.showRawText(d))
            .call(d3.drag()
                .on('start', (event: any, d: any) => this.dragstarted(event, d))
                .on('drag', (event: any, d: any) => this.dragged(event, d))
                .on('end', (event: any, d: any) => this.dragended(event, d)));

        // Add shapes to nodes
        node.each(function(this: any, d: any) {
            const nodeGroup = d3.select(this);
            
            if (d.type === 'definition') {
                nodeGroup.append('rect')
                    .attr('width', 40)
                    .attr('height', 40)
                    .attr('x', -20)
                    .attr('y', -20)
                    .attr('rx', 5);
            } else {
                nodeGroup.append('circle')
                    .attr('r', 20);
            }
        });

        // Style the shapes
        node.select('rect, circle')
            .attr('fill', (d: any) => this.getNodeColor(d))
            .attr('stroke', (d: any) => this.getNodeStroke(d))
            .attr('stroke-width', 2);

        // Add labels
        node.append('text')
            .text((d: any) => d.id)
            .attr('dy', 35)
            .attr('text-anchor', 'middle')
            .attr('font-family', 'Arial, sans-serif')
            .attr('font-size', '12px')
            .attr('fill', '#333');

        // Add tooltips
        node.append('title')
            .text((d: any) => `${d.id} (${d.type})\nFile: ${d.fileName}\n${this.getNodeLabel(d)}\n\nClick to view raw text`);

        // Update positions on simulation tick
        this.simulation.on('tick', () => {
            link
                .attr('x1', (d: any) => d.source.x)
                .attr('y1', (d: any) => d.source.y)
                .attr('x2', (d: any) => d.target.x)
                .attr('y2', (d: any) => d.target.y);

            node
                .attr('transform', (d: any) => `translate(${d.x},${d.y})`);
        });

        // Add legend
        this.addLegend();

        // Update info panel
        this.updateInfoPanel(nodes, links);
    }

    private addLegend() {
        const legend = this.svg.append('g')
            .attr('class', 'legend')
            .attr('transform', 'translate(20, 20)');

        const legendData = [
            { type: 'definition', complete: true, label: 'Definition (Lean ✓)' },
            { type: 'definition', complete: false, label: 'Definition (No Lean)' },
            { type: 'theorem', complete: true, label: 'Theorem (Statement + Proof)' },
            { type: 'theorem', complete: 'partial', label: 'Theorem (Statement Only)' },
            { type: 'theorem', complete: false, label: 'Theorem (No Lean)' }
        ];

        legendData.forEach((item, i) => {
            const legendItem = legend.append('g')
                .attr('transform', `translate(0, ${i * 25})`);

            if (item.type === 'definition') {
                legendItem.append('rect')
                    .attr('width', 15)
                    .attr('height', 15)
                    .attr('x', 0)
                    .attr('y', 0)
                    .attr('fill', item.complete ? '#90EE90' : '#F08080')
                    .attr('stroke', item.complete ? '#006400' : '#8B0000');
            } else {
                const color = item.complete === true ? '#90EE90' : 
                             item.complete === 'partial' ? '#FFFFE0' : '#F08080';
                const stroke = item.complete === true ? '#006400' : 
                              item.complete === 'partial' ? '#FFA500' : '#8B0000';
                
                legendItem.append('circle')
                    .attr('cx', 7.5)
                    .attr('cy', 7.5)
                    .attr('r', 7.5)
                    .attr('fill', color)
                    .attr('stroke', stroke);
            }

            legendItem.append('text')
                .attr('x', 25)
                .attr('y', 12)
                .attr('font-family', 'Arial, sans-serif')
                .attr('font-size', '12px')
                .text(item.label);
        });
    }

    private updateInfoPanel(nodes: D3Node[], links: D3Link[]) {
        const infoPanel = document.getElementById('info');
        if (infoPanel) {
            const totalNodes = nodes.length;
            const definitionNodes = nodes.filter(n => n.type === 'definition').length;
            const theoremNodes = nodes.filter(n => n.type === 'theorem').length;
            const completedNodes = nodes.filter(n => n.leanDone).length;
            
            infoPanel.innerHTML = `
                <h3>Graph Statistics</h3>
                <p><strong>Total Nodes:</strong> ${totalNodes}</p>
                <p><strong>Definitions:</strong> ${definitionNodes}</p>
                <p><strong>Theorems:</strong> ${theoremNodes}</p>
                <p><strong>Lean Complete:</strong> ${completedNodes} (${Math.round(completedNodes/totalNodes*100)}%)</p>
                <p><strong>Dependencies:</strong> ${links.length}</p>
            `;
        }
    }

    private dragstarted(event: any, d: any) {
        if (!event.active) this.simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    private dragged(event: any, d: any) {
        d.fx = event.x;
        d.fy = event.y;
    }

    private dragended(event: any, d: any) {
        if (!event.active) this.simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    private showRawText(d3Node: D3Node) {
        // Find the original node data
        const originalNode = this.originalNodes.find(node => node.id === d3Node.id);
        if (!originalNode) {
            console.error('Original node data not found for:', d3Node.id);
            return;
        }

        // Create or update modal
        let modal = document.getElementById('raw-text-modal');
        let overlay = document.getElementById('modal-overlay');

        if (!modal) {
            // Create overlay
            overlay = document.createElement('div');
            overlay.id = 'modal-overlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                z-index: 999;
                display: none;
            `;
            overlay.onclick = () => this.hideModal();
            document.body.appendChild(overlay);

            // Create modal
            modal = document.createElement('div');
            modal.id = 'raw-text-modal';
            modal.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                border: 2px solid #ccc;
                border-radius: 8px;
                padding: 20px;
                max-width: 80%;
                max-height: 80%;
                overflow: auto;
                box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                z-index: 1000;
                font-family: 'Arial', sans-serif;
                display: none;
            `;
            document.body.appendChild(modal);
        }

        // Create content
        let leanStatus = '';
        if (originalNode.type === 'definition') {
            leanStatus = originalNode.leanDone ? 'Lean: Done' : 'Lean: Not done';
        } else {
            const theoremNode = originalNode as GraphTheoremNode;
            if (theoremNode.statementLeanDone && theoremNode.proofLeanDone) {
                leanStatus = 'Lean: Full (statement + proof)';
            } else if (theoremNode.statementLeanDone) {
                leanStatus = 'Lean: Partial (just statement)';
            } else {
                leanStatus = 'Lean: No lean (no statement)';
            }
        }

        const content = `
            <div style="position: relative;">
                <h2 style="margin-top: 0; color: #333;">${originalNode.id}</h2>
                
                <div style="margin-bottom: 15px; padding: 10px; background: #f0f0f0; border-radius: 4px;">
                    <p style="margin: 5px 0;"><strong>Type:</strong> ${originalNode.type}</p>
                    <p style="margin: 5px 0;"><strong>File:</strong> ${originalNode.fileName}</p>
                    <p style="margin: 5px 0;"><strong>Status:</strong> ${leanStatus}</p>
                </div>
                
                <h3 style="color: #333; border-bottom: 2px solid #ddd; padding-bottom: 5px;">Raw LaTeX Text</h3>
                <div id="latex-content" class="tex2jax_process" style="background: #f8f8f8; padding: 15px; border-radius: 4px; font-family: 'Times New Roman', serif; font-size: 16px; line-height: 1.6; border-left: 4px solid #007acc; max-height: 400px; overflow-y: auto;">
                    ${this.escapeHtml(this.cleanLatexText(originalNode.rawText))}
                </div>
                
                ${originalNode.type === 'theorem' && (originalNode as GraphTheoremNode).proofText ? `
                    <h3 style="color: #333; border-bottom: 2px solid #ddd; padding-bottom: 5px; margin-top: 20px;">Proof</h3>
                    <div id="proof-content" class="tex2jax_process" style="background: #f0f8ff; padding: 15px; border-radius: 4px; font-family: 'Times New Roman', serif; font-size: 16px; line-height: 1.6; border-left: 4px solid #28a745; max-height: 400px; overflow-y: auto;">
                        ${this.escapeHtml(this.cleanLatexText((originalNode as GraphTheoremNode).proofText!))}
                    </div>
                ` : ''}
            </div>
        `;

        modal.innerHTML = content;

        // Re-add close button
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `
            position: absolute;
            top: 10px;
            right: 15px;
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #666;
        `;
        closeBtn.onclick = () => {
            modal!.style.display = 'none';
            document.getElementById('modal-overlay')!.style.display = 'none';
        };
        modal.appendChild(closeBtn);

        // Show modal
        modal.style.display = 'block';
        overlay!.style.display = 'block';

        // Trigger MathJax rendering only on the LaTeX content containers
        if ((window as any).MathJax) {
            const latexContainers = modal.querySelectorAll('.tex2jax_process');
            if (latexContainers.length > 0) {
                (window as any).MathJax.typesetPromise(Array.from(latexContainers)).catch((err: any) => {
                    console.error('MathJax rendering error:', err);
                });
            }
        }
        modal.style.display = 'block';
        overlay!.style.display = 'block';
    }

    private hideModal() {
        const modal = document.getElementById('raw-text-modal');
        const overlay = document.getElementById('modal-overlay');
        if (modal) modal.style.display = 'none';
        if (overlay) overlay.style.display = 'none';
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    private cleanLatexText(text: string): string {
        // Remove LaTeX commands like \label{...}, \uses{...}, \leanok, etc.
        // but keep mathematical content and structure
        return text
            .replace(/\\label\{[^}]*\}/g, '')           // Remove \label{...}
            .replace(/\\uses\{[^}]*\}/g, '')            // Remove \uses{...}
            .replace(/\\leanok\b/g, '')                 // Remove \leanok
            .replace(/\\lean\{[^}]*\}/g, '')            // Remove \lean{...}
            .replace(/\n\s*\n\s*\n/g, '\n\n')          // Clean up extra newlines
            .trim();                                     // Remove leading/trailing whitespace
    }
}