#!/usr/bin/env node
'use strict';

const fs = require("fs");
const path = require("path");
const md2pdf = require('./markdown-to-pdf');


const DEFAULT_THEME_FILE = '/styles/markdown.css';
const DEFAULT_HIGHLIGHT_FILE = '/styles/highlight.css';
const DEFAULT_TEMPLATE_FILE = '/template/template.html';
const RUNNER_DIR = '/github/workspace/';


function getRunnerInput(name, def, transformer = val => val) {
	let value = process.env['INPUT_' + name.toUpperCase()];
	
	return (value === undefined || value === '') ? def : transformer(value);
}

function getRunnerPath(file) {
	file = path.normalize(RUNNER_DIR + file);
	
	if(!file.startsWith(RUNNER_DIR)) throw `Cannot move outside of directory '${RUNNER_DIR}'`;
	
	return file;
}

function getRunnerDir(file) {
	if(file[-1] !== '/') file += '/';
	
	return getRunnerPath(file);
}

function booleanTransformer(bool) {
	return bool === 'true';
}


// GitHub Action inputs that are needed for this program to run
const InputDir = getRunnerInput('input_dir', '', getRunnerDir);
const ImageImport = getRunnerInput('image_import', null);
const ImageDir = getRunnerInput('images_dir', InputDir + md2pdf.nullCoalescing(ImageImport, ''), getRunnerDir);

// Optional input, though recommended
const OutputDir = getRunnerInput('output_dir', 'built/', getRunnerDir);

// Whether to also output a <filename>.html file, there is a bit of magic at the end to ensure that the value is a boolean
const build_html = getRunnerInput('build_html', true, booleanTransformer);

// Custom CSS and HTML files for theming
const ThemeFile = getRunnerInput('theme', null, getRunnerPath);
const HighlightThemeFile = getRunnerInput('highlight_theme', DEFAULT_HIGHLIGHT_FILE, getRunnerPath);
const TemplateFile = getRunnerInput('template', DEFAULT_TEMPLATE_FILE, getRunnerPath);

// Whether to extend your custom CSS file with the default theme
const extend_default_theme = getRunnerInput('extend_default_theme', false, booleanTransformer);

// Table Of Contents settings
const table_of_contents = getRunnerInput('table_of_contents', false, booleanTransformer);


// CreateOutputDirectory creates the output directory if it doesn't exist
function CreateOutputDirectory(dirname) {
	if(!fs.existsSync(dirname)) {
		fs.mkdirSync(dirname);
	}
}

// GetMarkdownFiles returns an array of only files ending in .md or .markdown
// NOTE: When a file name is the same, eg. happy.md and happy.markdown, only one file is
// outputted as it will be overwritten. This needs to be checked. (TODO:)
function GetMarkdownFiles(files) {
	return files.filter(function(filePath) {
		if(path.extname(filePath).match(/^(.md|.markdown)$/)) {
			return true;
		}
	});
}

// GetFileBody retrieves the file content as a string
function GetFileBody(file) {
	return md2pdf.getFileContent(InputDir + file);
}

// UpdateFileName is a helper function to replace the extension
function UpdateFileName(fileName, extension) {
	fileName = fileName.split('.');
	fileName.pop();
	
	if(extension !== null) fileName.push(extension);
	
	return fileName.join('.');
}

// BuildHTML outputs the HTML string to a file
function BuildHTML(result, file) {
	file = UpdateFileName(file, 'html');
	
	result.writeHTML(OutputDir + file);
	
	console.log('Built HTML file: ' + file);
	console.log();
}

// BuildPDF outputs the PDF file after building it via a chromium package
function BuildPDF(result, file) {
	file = UpdateFileName(file, 'pdf');
	
	result.writePDF(OutputDir + file);
	
	console.log('Build PDF file: ' + file);
	console.log();
}


// Assign the style and template files to strings for later manipulation
const style = (extend_default_theme ? md2pdf.getFileContent(DEFAULT_THEME_FILE) : '')
	+ (ThemeFile === null ? '' : md2pdf.getFileContent(ThemeFile))
	+ md2pdf.getFileContent(HighlightThemeFile);
const template = md2pdf.getFileContent(TemplateFile);

let md = new md2pdf({
	image_import: ImageImport,
	image_dir: ImageDir,
	
	style: style,
	template: template,
	
	table_of_contents: table_of_contents,
});
md.start();
fs.readdir(InputDir, async function(err, files) {
	// Check output folder exists and fetch file array
	CreateOutputDirectory(OutputDir);
	
	files = GetMarkdownFiles(files);
	if(files.length === 0) throw 'No markdown files found! Exiting.';
	
	console.log('Markdown files found: ' + files.join(', '));
	
	// Loop through each file converting it
	for(let file of files) {
		// Get the content of the MD file and convert it
		let result = await md.convert(GetFileBody(file), UpdateFileName(file, null));
		
		// If the `build_html` environment variable is true, build the HTML
		if(build_html === true) {
			BuildHTML(result, file);
		}
		
		// Build the PDF file
		BuildPDF(result, file);
	}
	
	// Close the image server
	md.close();
});
