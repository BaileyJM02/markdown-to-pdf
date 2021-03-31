#!/usr/bin/env node
'use strict';

// Import everything we need
const fs = require('fs');
const path = require('path');
const hljs = require('highlight.js');
const express = require('express');
const mustache = require('mustache');
const puppeteer = require('puppeteer');
const markdownIt = require('markdown-it');
const { response } = require('express');
// Encoding is "null" so we can get the image correctly
const request = require('request').defaults({ encoding: null });

// GitHub Action inputs that are needed for this program to run
const images_dir = (process.env.INPUT_IMAGES_DIR == undefined || process.env.INPUT_IMAGES_DIR == "") ? "" : process.env.INPUT_IMAGES_DIR;
const input_dir = (process.env.INPUT_INPUT_DIR == undefined || process.env.INPUT_INPUT_DIR == "") ? "" : process.env.INPUT_INPUT_DIR;
const image_import = (process.env.INPUT_IMAGE_IMPORT == undefined || process.env.INPUT_IMAGE_IMPORT == "") ? null : process.env.INPUT_IMAGE_IMPORT;

// Optional input, though recommended
const output_dir = (process.env.INPUT_OUTPUT_DIR == undefined || process.env.INPUT_OUTPUT_DIR == "") ? "built" : process.env.INPUT_OUTPUT_DIR;

// Whether to also output a <filename>.html file, there is a bit of magic at the end to ensure that the value is a boolean
const build_html = (process.env.INPUT_BUILD_HTML == undefined || process.env.INPUT_BUILD_HTML == "") ? true : process.env.INPUT_BUILD_HTML === "true";

// Custom CSS and HTML files for theming
const ThemeFile = (process.env.INPUT_THEME == undefined || process.env.INPUT_THEME == "") ? "/styles/markdown.css" : '/github/workspace/' + process.env.INPUT_THEME;
const HighlightThemeFile = (process.env.INPUT_HIGHLIGHT_THEME == undefined || process.env.INPUT_HIGHLIGHT_THEME == "") ? "/styles/highlight.css" : '/github/workspace/' + process.env.INPUT_HIGHLIGHT_THEME;
const TemplateFile = (process.env.INPUT_TEMPLATE == undefined || process.env.INPUT_TEMPLATE == "") ? "/template/template.html" : '/github/workspace/' + process.env.INPUT_TEMPLATE;

// Custom timeout
const build_timeout = (process.env.INPUT_BUILD_TIMEOUT == undefined || process.env.INPUT_BUILD_TIMEOUT == "") ? NaN : parseInt(process.env.INPUT_BUILD_TIMEOUT);

// Assign express instance for image server
const app = express();

// Append Docker workspace structure to directories
const InputDir = '/github/workspace/' + input_dir + "/";
const OutputDir = '/github/workspace/' + output_dir + "/";
const ImageDir = '/github/workspace/' + images_dir + "/";
const ImageImport = image_import;

// Assign the style and template files to strings for later manipulation
const style =
	fs.readFileSync(ThemeFile).toString('utf-8')
	+ fs.readFileSync(HighlightThemeFile).toString('utf-8');
const template = fs.readFileSync(TemplateFile).toString('utf-8');

// 
const timeout = isNaN(build_timeout) ? 30000 : build_timeout;

// Start image server so we can encode images correctly
app.use(express.static(ImageDir))
let server = app.listen(3000);

console.log("Started image server with image folder route '" + ImageDir + "'.");

// GetMarkdownFiles returns an array of only files ending in .md or .markdown
// NOTE: When a file name is the same, eg. happy.md and happy.markdown, only one file is
// outputted as it will be overwritten. This needs to be checked. (TODO:)
function GetMarkdownFiles(files) {
	return files.filter(function (filePath) {
		if (path.extname(filePath).match(/^(.md|.markdown)$/)) {
			return true;
		}
	})
}

// GetMarkdownIt returns the instance of markdown-it with the correct settings
function GetMarkdownIt() {
	let md = new markdownIt({
		html: true,
		breaks: true,
		xhtmlOut: true,
		// Handle code snippet highlighting, we can catch this error as it will
		// be correctly handled by markdown-it
		highlight: function (str, lang) {
			if (lang && hljs.getLanguage(lang)) {
				try {
					return hljs.highlight(lang, str).value;
				} catch (__) { }
			}
			return ''; // use external default escaping
		}
	})
	// Import headers to ensure that the IDs are escaped
	md.use(require('markdown-it-named-headers'), {
		slugify: Slug
	});

	return md;
}
// UpdateFileName is a helper function to replace the extension
function UpdateFileName(fileName, extension) {
	var fileName = fileName.split('.');
	fileName.pop();
	(extension == null) ? "" : fileName.push(extension);
	return fileName.join(".");
}

// GetFileBody retrieves the file content as a string
function GetFileBody(file) {
	return fs.readFileSync(InputDir + file).toString('utf-8');
}

// ConvertImageRoutes this function changed all instances of the ImageImport path to localhost,
// it then fetches this URL and encodes it to base64 so we can include it in both the HTML and
// PDF files without having to lug around an images folder
async function ConvertImageRoutes(html) {
	if (ImageImport === null) { return html; }
	let imagePath = ImageImport.replace(/[-[\]{}()*+?.,\\^$|#\\]/g, '\\$&');
	let newPaths = html.replace(new RegExp(imagePath, "g"), "http://localhost:3000")
	let rex = /<img[^>]+src="([^">]+)"/g;
	let m
	let encoded
	while (m = rex.exec(newPaths)) {
		try {
			let image = await encodeImage(m[1]);
			newPaths = newPaths.replace(new RegExp(m[1], "g"), image);
		} catch (error) {
			console.log('ERROR:', error);
		}
		encoded = newPaths
	}
	return encoded;
}

// This converts the markdown string to it's HTML values # => h1 etc.
function ConvertToHtml(text) {
	let md = GetMarkdownIt();
	let body = md.render(text);
	let view = {
		style: style,
		content: body
	};
	// Compile the template
	return mustache.render(template, view);
}

// BuildHTML outputs the HTML string to a file
function BuildHTML(html, file) {
	fs.writeFileSync(OutputDir + UpdateFileName(file, "html"), html)
	console.log("Built HTML file: " + UpdateFileName(file, "html"));
}

// BuildPDF outputs the PDF file after building it via a chromium package
function BuildPDF(data, file) {
	let PDFLayout = {
		path: OutputDir + UpdateFileName(file, "pdf"),
		format: 'A4',
		scale: .9,
		displayHeaderFooter: false,
		margin: { top: 50, bottom: 50, right: '50', left: '50' }
	};

	// Async function as this is event/time sensitive
	(async () => {
		const browser = await puppeteer.launch({
			args: [
				'--headless',
				'--no-sandbox',
				'--disable-setuid-sandbox'
			]
		})
		const page = await browser.newPage();
		await page.goto(`data:text/html;,${encodeURIComponent(data)}`, { waitUntil: 'networkidle0', timeout: timeout });
		await page.pdf(PDFLayout);
		await browser.close();
	})();

	console.log("Built PDF file: " + UpdateFileName(file, "pdf"));
}

// encodeImage is a helper function to fetch a URL and return the image as a base64 string
async function encodeImage(url) {
	return new Promise((resolve, reject) => {
		request.get(url, function (error, response, body) {
			if (error) {
				console.log(error);
				return resolve(null);
			}
			if (response.statusCode != 200) {
				console.log("Image not found, is the image folder route correct? [" + url + "]");
				return resolve(null);
			}
			let data = "data:" + response.headers["content-type"].replace(" ", "") + ";base64," + new Buffer.from(body).toString('base64');
			return resolve(data);
		})
	});
}

// Slug is a helper function to escape characters in the titles URL
function Slug(string, used_headers) {
	let slug = encodeURI(string.trim()
		.toLowerCase()
		.replace(/[\]\[\!\"\#\$\%\&\'\(\)\*\+\,\.\/\:\;\<\=\>\?\@\\\^\_\{\|\}\~\`]/g, '')
		.replace(/\s+/g, '-')
		.replace(/^\-+/, '')
		.replace(/\-+$/, ''));
	if (used_headers[slug]) {
		used_headers[slug]++;
		slug += '-' + used_headers[slug];
	} else {
		used_headers[slug] = 0;
	}
	return slug;
}

// CreateOutputDirectory creates the output directory if it doesn't exist
function CreateOutputDirectory(dirname) {
	if (!fs.existsSync(dirname)) {
		fs.mkdirSync(dirname);
	}
}

// Start is a wrapper function to call the readdir folder
async function Start() {
	await fs.readdir(InputDir, async function (err, files) {
		// Check output folder exists and fetch file array
		await CreateOutputDirectory(OutputDir);
		files = await GetMarkdownFiles(files);

		if (files.length == 0) {
			console.log('No markdown files found. Exiting.');
			return process.exit(0);
		} else {
			console.log('Markdown files found: ' + files.join(', '));
		}

		// Loop through each file converting it
		for (let file of files) {

			// Get the HTML from the MD file
			let text = await GetFileBody(file)
			let preHTML = await ConvertToHtml(text);
			let html = await ConvertImageRoutes(preHTML);

			// If the `build_html` environment variable is true, build the HTML
			if (build_html == true) {
				await BuildHTML(html, file);
			}

			// Build the PDF file
			await BuildPDF(html, file);

			// If the loop has reached the final stage, shut down the image server
			if (file == files.slice(-1)[0]) {
				server.close(function () { console.log('Gracefully shut down image server.'); });
			}
		}
	});
}

// Start the convert process
Start();
