import * as fs from 'fs';
import * as path from 'path';

/**
 * This scripts reads all .tex files in a given directory
 * 
 * For each one it looks for statements of the form
 * \begin{X}
 * 
 * \end{X}
 * 
 * They can be multiline, but can't be nested
 * 
 * 
 * Inside each such block there can be \<command>{<text>}
 * commands that need to be parsed and stored in the block
 * 
 * The {} block on a command is optional.
 * 
 * If one block follows another, that should be recorded too
 */

interface Command {
    type: string;
    body?: string;
}

interface RawBlock {
    type: string;
    rawText: string;
    commands: Command[];
    fileName: string;
    // only used for proofs following theorems
    immediatePrevious: RawBlock | null;
}

const blockRegex = /\\begin{(\w+)}([\s\S]*?)\\end{\1}/g;
const commandRegex = /\\(\w+)(?:{([^}]*)})?/g;

function parseCommandsSkippingMath(text: string): Command[] {
    const commands: Command[] = [];
    
    // Find all math mode sections ($ ... $)
    const mathSections: Array<{start: number, end: number}> = [];
    const mathRegex = /\$([^$]*)\$/g;
    let mathMatch: RegExpExecArray | null;
    
    while ((mathMatch = mathRegex.exec(text)) !== null) {
        mathSections.push({
            start: mathMatch.index,
            end: mathMatch.index + mathMatch[0].length
        });
    }
    
    // Parse commands, but skip those inside math sections
    commandRegex.lastIndex = 0;
    let cmdMatch: RegExpExecArray | null;
    
    while ((cmdMatch = commandRegex.exec(text)) !== null) {
        const commandStart = cmdMatch.index;
        const commandEnd = cmdMatch.index + cmdMatch[0].length;
        
        // Check if this command is inside any math section
        const isInMath = mathSections.some(section => 
            commandStart >= section.start && commandEnd <= section.end
        );
        
        if (!isInMath) {
            commands.push({ type: cmdMatch[1], body: cmdMatch[2] });
        }
    }
    
    return commands;
}

function getTexFiles(dir: string): string[] {
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.tex'))
        .map(f => path.join(dir, f));
}

function parseBlocks(content: string, fileName: string): RawBlock[] {
    const blocks: RawBlock[] = [];
    let match: RegExpExecArray | null;
    let lastBlock: RawBlock | null = null;
    blockRegex.lastIndex = 0;
    while ((match = blockRegex.exec(content)) !== null) {
        const [, type, rawText] = match;
        
        // Parse commands but skip those inside $ $ (math mode)
        const commands = parseCommandsSkippingMath(rawText);
        
        const block: RawBlock = {
            type,
            rawText,
            commands,
            fileName,
            immediatePrevious: lastBlock
        };
        blocks.push(block);
        lastBlock = block;
    }
    return blocks;
}

/**
 * Transform the raw blocks and commands into a dependency graph of Nodes
 * 
 * use \label for id 
 * use \uses to find dependencies.
 * use \leanok to record lean done.
 * both theorem or lemma are theorem node
 * for theorem nodes combine raw theorem and subsequent proof nodes.
 * infer lean status of statement and proof separately.
 */
interface BaseNode {
    id: string;
    dependencies: Node[];
}

interface DefinitionNode extends BaseNode {
    type: 'definition';
    leanDone: boolean;
    rawDefinition: RawBlock;
}

interface TheoremNode extends BaseNode {
    type: 'theorem';
    statementLeanDone: boolean;
    proofLeanDone: boolean;
    rawStatement: RawBlock;
    rawProof: RawBlock;
}

type Node = DefinitionNode | TheoremNode;

interface CleanBaseNode {
    id: string;
    type: 'definition' | 'theorem';
    fileName: string;
    rawText: string;
    dependencies: { id: string; type: 'definition' | 'theorem' }[];
}

interface CleanDefinitionNode extends CleanBaseNode {
    type: 'definition';
    leanDone: boolean;
}

interface CleanTheoremNode extends CleanBaseNode {
    type: 'theorem';
    statementLeanDone: boolean;
    proofLeanDone: boolean;
    proofText?: string; // Optional, only if different from rawText
}

type CleanNode = CleanDefinitionNode | CleanTheoremNode;

function transformToDepGraph(allBlocks: RawBlock[]): Node[] {
    const nodes: Node[] = [];
    const blockIdMap = new Map<string, RawBlock>();
    
    // First pass: build a map of label -> block for quick lookup
    for (const block of allBlocks) {
        const labelCommand = block.commands.find(cmd => cmd.type === 'label');
        if (labelCommand && labelCommand.body) {
            blockIdMap.set(labelCommand.body, block);
        }
    }
    
    // Second pass: process blocks and combine theorem+proof pairs
    let i = 0;
    while (i < allBlocks.length) {
        const block = allBlocks[i];
        const labelCommand = block.commands.find(cmd => cmd.type === 'label');
        
        if (!labelCommand || !labelCommand.body) {
            i++;
            continue; // Skip blocks without labels
        }
        
        const id = labelCommand.body;
        const leanokCommand = block.commands.find(cmd => cmd.type === 'leanok');
        const usesCommands = block.commands.filter(cmd => cmd.type === 'uses');
        
        if (block.type === 'definition') {
            const defNode: DefinitionNode = {
                type: 'definition',
                id,
                leanDone: !!leanokCommand,
                rawDefinition: block,
                dependencies: [] // Will be filled later
            };
            nodes.push(defNode);
        } else if (block.type === 'theorem' || block.type === 'lemma') {
            // Look for a following proof block
            let proofBlock: RawBlock | null = null;
            let statementLeanDone = !!leanokCommand;
            let proofLeanDone = false;
            
            if (i + 1 < allBlocks.length && allBlocks[i + 1].type === 'proof') {
                proofBlock = allBlocks[i + 1];
                const proofLeanokCommand = proofBlock.commands.find(cmd => cmd.type === 'leanok');
                proofLeanDone = !!proofLeanokCommand;
                i++; // Skip the proof block in next iteration
            }
            
            const theoremNode: TheoremNode = {
                type: 'theorem',
                id,
                statementLeanDone,
                proofLeanDone,
                rawStatement: block,
                rawProof: proofBlock || block, // Use statement block if no proof found
                dependencies: [] // Will be filled later
            };
            nodes.push(theoremNode);
        }
        
        i++;
    }
    
    // Third pass: resolve dependencies using \uses commands
    for (const node of nodes) {
        const usesCommands = node.type === 'definition' 
            ? node.rawDefinition.commands.filter(cmd => cmd.type === 'uses')
            : [...node.rawStatement.commands.filter(cmd => cmd.type === 'uses'),
               ...node.rawProof.commands.filter(cmd => cmd.type === 'uses')];
        
        for (const usesCommand of usesCommands) {
            if (usesCommand.body) {
                const dependencyNode = nodes.find(n => n.id === usesCommand.body);
                if (dependencyNode) {
                    node.dependencies.push(dependencyNode);
                }
            }
        }
    }
    
    return nodes;
}

/**
 * Emit the dep graph built into a graphviz dot format.
 * 
 * Use different backgrounds for lean status
 * Use different shapes for definition vs theorem.
 */
function emitGraphvizDot(nodes: Node[]): string {
    let dot = 'digraph DependencyGraph {\n';
    dot += '  rankdir=TB;\n';
    dot += '  node [fontname="Arial", fontsize=10];\n';
    dot += '  edge [fontname="Arial", fontsize=8];\n\n';
    
    // Emit nodes with styling
    for (const node of nodes) {
        const nodeId = `"${node.id}"`;
        let shape: string;
        let color: string;
        let fillcolor: string;
        let label: string;
        
        if (node.type === 'definition') {
            shape = 'box';
            label = `${node.id}\\n(Definition)`;
            if (node.leanDone) {
                fillcolor = 'lightgreen';
                color = 'darkgreen';
            } else {
                fillcolor = 'lightcoral';
                color = 'darkred';
            }
        } else {
            shape = 'ellipse';
            label = `${node.id}\\n(Theorem)`;
            
            // Color based on completion status
            if (node.statementLeanDone && node.proofLeanDone) {
                fillcolor = 'lightgreen';
                color = 'darkgreen';
            } else if (node.statementLeanDone || node.proofLeanDone) {
                fillcolor = 'lightyellow';
                color = 'orange';
            } else {
                fillcolor = 'lightcoral';
                color = 'darkred';
            }
            
            // Add status details to label
            const statusParts = [];
            if (node.statementLeanDone) statusParts.push('stmt✓');
            if (node.proofLeanDone) statusParts.push('proof✓');
            if (statusParts.length > 0) {
                label += `\\n(${statusParts.join(', ')})`;
            }
        }
        
        dot += `  ${nodeId} [shape=${shape}, style=filled, fillcolor=${fillcolor}, color=${color}, label="${label}"];\n`;
    }
    
    dot += '\n';
    
    // Emit edges
    for (const node of nodes) {
        const nodeId = `"${node.id}"`;
        for (const dep of node.dependencies) {
            const depId = `"${dep.id}"`;
            dot += `  ${depId} -> ${nodeId};\n`;
        }
    }
    
    dot += '}\n';
    return dot;
}

function generateHTMLWithEmbeddedData(nodes: CleanNode[], outputDir: string) {
    const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dependency Graph Visualizer</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .header {
            background-color: #2c3e50;
            color: white;
            padding: 20px;
            text-align: center;
        }
        
        .header h1 {
            margin: 0;
            font-size: 2em;
        }
        
        .header p {
            margin: 10px 0 0 0;
            opacity: 0.8;
        }
        
        .main-content {
            display: flex;
            min-height: 800px;
        }
        
        .sidebar {
            width: 300px;
            background-color: #ecf0f1;
            border-right: 1px solid #bdc3c7;
            padding: 20px;
            box-sizing: border-box;
        }
        
        .graph-area {
            flex: 1;
            position: relative;
            background-color: white;
        }
        
        #graph-container {
            width: 100%;
            height: 800px;
            overflow: hidden;
        }
        
        #error {
            color: #e74c3c;
            padding: 20px;
            text-align: center;
            font-weight: bold;
        }
        
        .controls {
            margin-bottom: 20px;
        }
        
        .controls h3 {
            margin-top: 0;
            color: #2c3e50;
            border-bottom: 2px solid #3498db;
            padding-bottom: 5px;
        }
        
        .control-group {
            margin-bottom: 15px;
        }
        
        .control-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
            color: #34495e;
        }
        
        .control-group button {
            width: 100%;
            padding: 10px;
            background-color: #3498db;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        
        .control-group button:hover {
            background-color: #2980b9;
        }
        
        #info {
            background-color: white;
            border: 1px solid #bdc3c7;
            border-radius: 4px;
            padding: 15px;
        }
        
        #info h3 {
            margin-top: 0;
            color: #2c3e50;
        }
        
        #info p {
            margin: 8px 0;
            line-height: 1.4;
        }
        
        .instructions {
            margin-top: 20px;
            padding: 15px;
            background-color: #e8f4fd;
            border: 1px solid #3498db;
            border-radius: 4px;
        }
        
        .instructions h4 {
            margin-top: 0;
            color: #2980b9;
        }
        
        .instructions ul {
            margin: 10px 0;
            padding-left: 20px;
        }
        
        .instructions li {
            margin-bottom: 5px;
            font-size: 13px;
        }

        /* SVG styles */
        .links line {
            stroke: #999;
            stroke-opacity: 0.6;
            stroke-width: 2px;
        }
        
        .nodes circle, .nodes rect {
            stroke-width: 2px;
            cursor: pointer;
        }
        
        .nodes text {
            pointer-events: none;
            font-family: Arial, sans-serif;
            font-size: 12px;
        }
        
        .legend text {
            font-family: Arial, sans-serif;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header tex2jax_ignore">
            <h1>Mathematical Dependency Graph</h1>
            <p>Interactive visualization of theorem and definition dependencies with Lean formalization status</p>
        </div>
        
        <div class="main-content">
            <div class="sidebar tex2jax_ignore">
                <div class="controls">
                    <h3>Controls</h3>
                    
                    <div class="control-group">
                        <button id="reset-zoom">Reset Zoom</button>
                    </div>
                </div>
                
                <div id="info">
                    <h3>Graph Statistics</h3>
                    <p>Loading...</p>
                </div>
                
                <div class="instructions">
                    <h4>Instructions</h4>
                    <ul>
                        <li><strong>Drag</strong> nodes to reposition them</li>
                        <li><strong>Scroll</strong> to zoom in/out</li>
                        <li><strong>Hover</strong> over nodes for details</li>
                        <li><strong>Click</strong> on any node to view raw LaTeX text</li>
                        <li><strong>Click</strong> "Reset Zoom" to center the graph</li>
                    </ul>
                    
                    <h4>Lean Status</h4>
                    <ul>
                        <li><strong>Green:</strong> Full Lean (statement + proof)</li>
                        <li><strong>Yellow:</strong> Partial Lean (statement only)</li>
                        <li><strong>Red:</strong> No Lean formalization</li>
                    </ul>
                </div>
            </div>
            
            <div class="graph-area">
                <div id="graph-container" class="tex2jax_ignore"></div>
                <div id="error" class="tex2jax_ignore" style="display: none;"></div>
            </div>
        </div>
    </div>

    <!-- Embedded data -->
    <script>
        window.DEPENDENCY_DATA = ${JSON.stringify(nodes, null, 8)};
    </script>

    <!-- D3.js from CDN -->
    <script src="https://d3js.org/d3.v7.min.js"></script>
    
    <!-- MathJax for LaTeX rendering -->
    <script>
        window.MathJax = {
            tex: {
                inlineMath: [['$', '$'], ['\\(', '\\)']],
                displayMath: [['$$', '$$'], ['\\[', '\\]']],
                processEscapes: true,
                processEnvironments: true
            },
            options: {
                skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre'],
                processHtmlClass: 'tex2jax_process',
                ignoreHtmlClass: 'tex2jax_ignore'
            },
            startup: {
                typeset: false  // Don't process the entire page on startup
            }
        };
    </script>
    <script src="https://polyfill.io/v3/polyfill.min.js?features=es6"></script>
    <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
    
    <!-- Inline visualization script -->
    <script>
        ${fs.readFileSync(path.join(__dirname, 'web.js'), 'utf8')}
    </script>
    
    <script>
        // Initialize with embedded data
        document.addEventListener('DOMContentLoaded', () => {
            const visualizer = new DependencyGraphVisualizer('graph-container');
            visualizer.loadEmbeddedData(window.DEPENDENCY_DATA);
        });
        
        // Controls
        document.getElementById('reset-zoom').addEventListener('click', () => {
            const svg = d3.select('#graph-container svg');
            svg.transition().duration(750).call(
                d3.zoom().transform,
                d3.zoomIdentity
            );
        });
    </script>
</body>
</html>`;

    const outputFile = path.join(outputDir, 'dependency_graph.html');
    fs.writeFileSync(outputFile, htmlTemplate);
}

function main() {
    // Read directory from command line arguments, default to current directory
    const texDir = process.argv[2] || './';

    if (!fs.existsSync(texDir)) {
        console.error(`Error: Directory '${texDir}' does not exist.`);
        console.error('Usage: node index.js [directory]');
        process.exit(1);
    }

    if (!fs.statSync(texDir).isDirectory()) {
        console.error(`Error: '${texDir}' is not a directory.`);
        console.error('Usage: node index.js [directory]');
        process.exit(1);
    }

    const files = getTexFiles(texDir);

    if (files.length === 0) {
        console.log(`No .tex files found in directory: ${texDir}`);
        return;
    }

    console.log(`Processing ${files.length} .tex file(s) in directory: ${texDir}`);
    console.log('');

    // Collect all blocks from all files
    const allBlocks: RawBlock[] = [];
    
    for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        const blocks = parseBlocks(content, file);
        allBlocks.push(...blocks);
    }
    
    // Transform raw blocks into dependency graph
    const depGraph = transformToDepGraph(allBlocks);
    
    // Create build directory in current working directory
    const buildDir = path.join(process.cwd(), 'build');
    if (!fs.existsSync(buildDir)) {
        fs.mkdirSync(buildDir, { recursive: true });
    }
    
    // Generate and output DOT format
    const dotOutput = emitGraphvizDot(depGraph);
    console.log(dotOutput);
    
    // Also save to file
    const outputFile = path.join(buildDir, 'dependency_graph.dot');
    fs.writeFileSync(outputFile, dotOutput);
    
    // Generate and save JSON format (without raw blocks but with raw text)
    const cleanGraph: CleanNode[] = depGraph.map(node => {
        if (node.type === 'definition') {
            return {
                id: node.id,
                type: 'definition' as const,
                leanDone: node.leanDone,
                fileName: node.rawDefinition.fileName,
                rawText: node.rawDefinition.rawText,
                dependencies: node.dependencies.map(dep => ({ id: dep.id, type: dep.type }))
            };
        } else {
            return {
                id: node.id,
                type: 'theorem' as const,
                statementLeanDone: node.statementLeanDone,
                proofLeanDone: node.proofLeanDone,
                fileName: node.rawStatement.fileName,
                rawText: node.rawStatement.rawText,
                proofText: node.rawProof.rawText !== node.rawStatement.rawText ? node.rawProof.rawText : undefined,
                dependencies: node.dependencies.map(dep => ({ id: dep.id, type: dep.type }))
            };
        }
    });
    
    const jsonOutput = JSON.stringify(cleanGraph, null, 2);
    const jsonFile = path.join(buildDir, 'dependency_graph.json');
    fs.writeFileSync(jsonFile, jsonOutput);
    
    // Generate HTML with embedded data
    generateHTMLWithEmbeddedData(cleanGraph, buildDir);
    
    console.log(`\nDependency graph saved to: ${outputFile}`);
    console.log(`JSON data saved to: ${jsonFile}`);
    console.log(`Interactive HTML saved to: ${path.join(buildDir, 'dependency_graph.html')}`);
    console.log(`\nProcessed ${allBlocks.length} blocks from ${files.length} files in: ${texDir}`);
    console.log('To generate PNG: dot -Tpng build/dependency_graph.dot -o build/dependency_graph.png');
    console.log('To generate SVG: dot -Tsvg build/dependency_graph.dot -o build/dependency_graph.svg');
}

main();
