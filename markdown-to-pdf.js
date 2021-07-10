#!/usr/bin/env node
'use strict';

// Import everything we need
const fs = require('fs');
const path = require('path');
const hljs = require('highlight.js');
const express = require('express');
const mustache = require('mustache');
const puppeteer = require('puppeteer');
const MarkdownIt = require('markdown-it');
const request = require('request').defaults({encoding: null}); // Encoding is "null" so we can get the image correctly


const RUNNER_DIR = '/github/workspace/';
const DEFAULT_THEME_FILE = '/styles/markdown.css';


function getRunnerInput(name, def, transformer = val => val) {
	let value = process.env['INPUT_' + name.toUpperCase()];
	
	return (value === undefined || value === '') ? def : transformer(value);
}

function getRunnerPath(file) {
	file = path.normalize(RUNNER_DIR + file);
	
	if(!file.startsWith(RUNNER_DIR)) throw `Cannot move outside of directory '${RUNNER_DIR}'`;
	
	return file;
}


// GitHub Action inputs that are needed for this program to run
const InputDir = getRunnerInput('input_dir', '', getRunnerPath);
const ImageImport = getRunnerInput('image_import', null);
const ImageDir = getRunnerInput('images_dir', InputDir + '/' + ImageImport, getRunnerPath);

// Optional input, though recommended
const OutputDir = getRunnerInput('output_dir', 'built', getRunnerPath);

// Whether to also output a <filename>.html file, there is a bit of magic at the end to ensure that the value is a boolean
const build_html = getRunnerInput('build_html', true, value => value === 'true');

// Custom CSS and HTML files for theming
const ThemeFile = getRunnerInput('theme', null, getRunnerPath);
const HighlightThemeFile = getRunnerInput('highlight_theme', '/styles/highlight.css', getRunnerPath);
const TemplateFile = getRunnerInput('template', '/template/template.html', getRunnerPath);

// Whether to extend your custom CSS file with the default theme
const extend_default_theme = getRunnerInput('extend_default_theme', false, value => value === 'true');

// Assign express instance for image server
const app = express();

// Assign the style and template files to strings for later manipulation
const style = (extend_default_theme ? fs.readFileSync(DEFAULT_THEME_FILE) : '')
	+ (ThemeFile === null ? '' : fs.readFileSync(ThemeFile).toString('utf-8'))
	+ fs.readFileSync(HighlightThemeFile).toString('utf-8');
const template = fs.readFileSync(TemplateFile).toString('utf-8');

// Start image server so we can encode images correctly
app.use(express.static(ImageDir))
let server = app.listen(3000);

console.log("Started image server with image folder route '" + ImageDir + "'.");
console.log();

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

// GetMarkdownIt returns the instance of markdown-it with the correct settings
function GetMarkdownIt() {
	let md = new MarkdownIt({
		html: true,
		breaks: true,
		xhtmlOut: true,
		// Handle code snippet highlighting, we can catch this error as it will
		// be correctly handled by markdown-it
		highlight: function(str, lang) {
			if(lang && hljs.getLanguage(lang)) {
				try {
					return hljs.highlight(lang, str).value;
				}catch(__) {
				}
			}
			
			return ''; // use external default escaping
		}
	});
	
	// Import headers to ensure that the IDs are escaped
	md.use(require('markdown-it-named-headers'), {slugify: Slug});
	
	return md;
}

// UpdateFileName is a helper function to replace the extension
function UpdateFileName(fileName, extension) {
	fileName = fileName.split('.');
	fileName.pop();
	
	if(extension !== null) fileName.push(extension);
	
	return fileName.join('.');
}

// GetFileBody retrieves the file content as a string
function GetFileBody(file) {
	return fs.readFileSync(InputDir + file).toString('utf-8');
}

// ConvertImageRoutes this function changed all instances of the ImageImport path to localhost,
// it then fetches this URL and encodes it to base64 so we can include it in both the HTML and
// PDF files without having to lug around an images folder
async function ConvertImageRoutes(html) {
	if(ImageImport === null) {
		return html;
	}
	
	let imagePath = ImageImport.replace(/[-\[\]{}()*+?.,\\^$|#]/g, '\\$&');
	let newPaths = html.replace(new RegExp(imagePath, 'g'), 'http://localhost:3000')
	let rex = /<img[^>]+src="([^">]+)"/g;
	let m;
	let encoded;
	
	while(m = rex.exec(newPaths)) {
		try {
			let image = await encodeImage(m[1]);
			
			if(image != null) {
				newPaths = newPaths.replace(new RegExp(m[1], 'g'), image);
			}
		}catch(error) {
			console.log('ERROR:', error);
		}
		
		encoded = newPaths;
	}
	
	return (encoded == null) ? newPaths : encoded;
}

// This converts the markdown string to it's HTML values # => h1 etc.
function ConvertToHtml(text, file) {
	let md = GetMarkdownIt();
	let body = md.render(text);
	let view = {
		title: UpdateFileName(file, null),
		style: style,
		content: body
	};
	
	// Compile the template
	return mustache.render(template, view);
}

// BuildHTML outputs the HTML string to a file
function BuildHTML(html, file) {
	fs.writeFileSync(OutputDir + UpdateFileName(file, 'html'), html);
	
	console.log('Built HTML file: ' + UpdateFileName(file, 'html'));
	console.log();
}

// BuildPDF outputs the PDF file after building it via a chromium package
function BuildPDF(data, file) {
	let PDFLayout = {
		path: OutputDir + UpdateFileName(file, 'pdf'),
		format: 'A4',
		scale: .9,
		displayHeaderFooter: false,
		margin: {top: 50, bottom: 50, right: 50, left: 50}
	};
	
	// Async function as this is event/time sensitive
	(async () => {
		const browser = await puppeteer.launch({
			args: [
				'--headless',
				'--no-sandbox',
				'--disable-setuid-sandbox'
			]
		});
		
		const page = await browser.newPage();
		await page.goto('data:text/html;,<h1>Not Rendered</h1>', {waitUntil: 'domcontentloaded', timeout: 2000});
		await page.setContent(data);
		await page.pdf(PDFLayout);
		await browser.close();
		
		console.log('Built PDF file: ' + UpdateFileName(file, 'pdf'));
	})();
}

// encodeImage is a helper function to fetch a URL and return the image as a base64 string
async function encodeImage(url) {
	return new Promise((resolve, reject) => {
		request.get(url, function(error, response, body) {
			if(error) {
				console.log(error);
				
				return resolve(null);
			}
			
			if(response.statusCode !== 200) {
				console.log('Image not found, is the image folder route correct? [' + url + ']');
				
				return resolve(null);
			}
			
			let data = 'data:' + response.headers['content-type'].replace(' ', '') + ';base64,' + new Buffer.from(body).toString('base64');
			
			return resolve(data);
		})
	});
}

// Slug is a helper function to escape characters in the titles URL
function Slug(string, used_headers) {
	let slug = encodeURI(string.trim()
		.toLowerCase()
		.replace(/[\]\[!"#$%&'()*+,.\/:;<=>?@\\^_{|}~`]/g, '')
		.replace(/\s+/g, '-')
		.replace(/^-+/, '')
		.replace(/-+$/, ''));
	
	if(used_headers[slug]) {
		used_headers[slug]++;
		slug += '-' + used_headers[slug];
	}else {
		used_headers[slug] = 0;
	}
	
	return slug;
}

// CreateOutputDirectory creates the output directory if it doesn't exist
function CreateOutputDirectory(dirname) {
	if(!fs.existsSync(dirname)) {
		fs.mkdirSync(dirname);
	}
}

// Start is a wrapper function to call the readdir folder
async function Start() {
	await fs.readdir(InputDir, async function(err, files) {
		// Check output folder exists and fetch file array
		await CreateOutputDirectory(OutputDir);
		
		files = await GetMarkdownFiles(files);
		
		if(files.length === 0) {
			console.log('No markdown files found. Exiting.');
			
			return process.exit(0);
		}else {
			console.log('Markdown files found: ' + files.join(', '));
		}
		
		// Loop through each file converting it
		for(let file of files) {
			// Get the HTML from the MD file
			let text = await GetFileBody(file);
			let preHTML = await ConvertToHtml(text, file);
			let html = await ConvertImageRoutes(preHTML);
			
			// If the `build_html` environment variable is true, build the HTML
			if(build_html === true) {
				await BuildHTML(html, file);
			}
			
			// Build the PDF file
			console.log('Awaiting the PDF Builder.');
			await BuildPDF(html, file);
			console.log('BuildPDF function has returned successfully.');
		}
		
		// Shutdown the image server
		server.close(function() {
			console.log('Gracefully shut down image server.');
		});
	});
}

// Start the convert process
Start();
