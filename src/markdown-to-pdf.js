#!/usr/bin/env node
'use strict';

// Import everything we need
const fs = require('fs');
const hljs = require('highlight.js');
const express = require('express');
const mustache = require('mustache');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const request = require('request').defaults({encoding: null}); // Encoding is "null" so we can get the image correctly
const markdownIt = require('markdown-it');
const markdownItAnchor = require('markdown-it-anchor');
const markdownItTOC = require('markdown-it-toc-done-right');
const markdownItEmoji = require('markdown-it-emoji');

function nullCoalescing(value, fallback) {
	return value !== undefined && value !== null ? value : fallback;
}

function getFileContent(file, encoding = 'utf-8') {
	return fs.readFileSync(file).toString(encoding);
}

// GetMarkdownIt returns the instance of markdown-it with the correct settings
function GetMarkdownIt() {
	let md = new markdownIt({
		html: true,
		breaks: false,
		xhtmlOut: true,
		style: 'github',
		// Handle code snippet highlighting, we can catch this error as it will
		// be correctly handled by markdown-it
		highlight: function(str, lang) {
			if(lang && hljs.getLanguage(lang)) {
				try {
					return hljs.highlight(str, {language: lang}).value;
				}catch(__) {
				}
			}
			
			return ''; // use external default escaping
		}
	});
	
	md.use(markdownItAnchor, {
		permalink: markdownItAnchor.permalink.ariaHidden({
			class: 'anchor',
			symbol: '<span class="octicon octicon-link"></span>',
			placement: 'before',
		}),
		slugify: slugify,
	});
	md.use(markdownItTOC, {
		containerId: 'table-of-contents',
		listType: 'ul',
		slugify: slugify,
	});
	md.use(markdownItEmoji);
	
	return md;
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
		});
	});
}

const used_headers = {};

// 'slugify' is a helper function to escape characters in the titles URL
function slugify(string) {
	let slug = encodeURIComponent(string.trim()
		.toLowerCase()
		.replace(/[\]\[!"#$%&'()*+,.\/:;<=>?@\\^_{|}~`]/g, '')
		.replace(/\s+/g, '-')
		.replace(/^-+/, '')
		.replace(/-+$/, ''));
	
	if(used_headers[slug]) {
		slug += '-' + ++used_headers[slug];
	}else {
		used_headers[slug] = 0;
	}
	
	return slug;
}


const PDFLayout = {
	format: 'A4',
	scale: .9,
	displayHeaderFooter: false,
	margin: {top: 50, bottom: 50, right: 50, left: 50}
};

class MarkdownToPDF {
	
	constructor(options) {
		this._image_import = options.image_import;
		this._image_dir = nullCoalescing(options.image_dir, this._image_import);
		
		this._style = options.style;
		this._template = options.template;
		
		this._table_of_contents = options.table_of_contents;
	}
	
	start() {
		this._image_server_app = express();
		this._image_server_app.use(express.static(this._image_dir));
		this._image_server = this._image_server_app.listen(3000);
		
		console.log("Started image server with image folder route '" + this._image_dir + "'.");
		console.log();
	}
	
	async convert(data, title) {
		if(typeof data !== 'string') throw "Parameter 'data' has to be a string containing Markdown content";
		if(typeof title !== 'string' && title !== undefined) throw "Parameter 'title' has to be a string";
		
		// Convert MD to HTML
		let preHTML = this._convertToHtml(data, nullCoalescing(title, ''));
		let html = await this._convertImageRoutes(preHTML).then(function (html) {
			return html;
		}).catch(function (err) {
			throw `Error while converting images: ${err}`;
		})
		
		// Build the PDF file
		const browser = await puppeteer.launch({
			args: [
				'--headless',
				'--no-sandbox',
				'--disable-gpu',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
				'--single-process'
			]
		}).then(function (browser) {
			return browser;
		}).catch(function (err) {
			throw `Error while launching puppeteer: ${err}`;
		})

		const page = await browser.newPage().then(function (page) {
			return page;
		}).catch(function (err) {
			throw `Error while creating new page: ${err}`;
		})

		await page.goto('data:text/html;,<h1>Not Rendered</h1>', {waitUntil: 'domcontentloaded', timeout: 2000}).catch(function (err) {
			throw `Error while rendering page: ${err}`;
		})
		await page.setContent(html).catch(function (err) {
			throw `Error while rendering page: ${err}`;
		})

		let pdf = await page.pdf(PDFLayout).then(function (pdf) {
			return pdf;
		}).catch(function (err) {
			throw `Error while rendering page: ${err}`;
		})

		await browser.close().catch(function (err) {
			throw `Error while rendering page: ${err}`;
		})

		return new Result(html, pdf);
	}
	
	close() {
		// Shutdown the image server
		this._image_server.close(function() {
			console.log();
			console.log('Gracefully shut down image server.');
		});
	}
	
	// This converts the markdown string to it's HTML values # => h1 etc.
	_convertToHtml(text, title) {
		if(this._table_of_contents) text = '[toc]\n' + text;
		
		let md = GetMarkdownIt();
		let body = md.render(text);
		let doc = cheerio.load(body);
		let toc = doc('nav#table-of-contents').html();
		
		doc('nav#table-of-contents').remove();
		body = doc('body').html();
		
		let view = {
			title: title,
			style: this._style,
			toc: toc,
			content: body,
		};
		
		// Compile the template
		return mustache.render(this._template, view);
	}
	
	// ConvertImageRoutes this function changed all instances of the ImageImport path to localhost,
	// it then fetches this URL and encodes it to base64 so we can include it in both the HTML and
	// PDF files without having to lug around an images folder
	async _convertImageRoutes(html) {
		if(this._image_import === null) {
			return html;
		}
		
		let imagePath = this._image_import.replace(/[-\[\]{}()*+?.,\\^$|#]/g, '\\$&');
		let imagePathRegex = new RegExp(imagePath, 'g');
		let imgTagRegex = /<img[^>]+src="([^">]+)"/g;
		let encoded = html;
		
		let m;
		while(m = imgTagRegex.exec(html)) {
			try {
				let path = m[1].replace(imagePathRegex, 'http://localhost:3000');
				let image = await encodeImage(path).then(function (image) {
					return image;
				}).catch(function (err) {
					throw `Error while converting image: ${err}`;
				})
				
				if(image !== null) {
					encoded = encoded.replace(m[1], image);
				}
			}catch(error) {
				console.log('ERROR:', error);
			}
		}
		
		return encoded;
	}
	
	
	static nullCoalescing = nullCoalescing;
	static getFileContent = getFileContent;
}

class Result {
	html;
	pdf;
	
	constructor(html, pdf) {
		this.html = html;
		this.pdf = pdf;
	}
	
	writeHTML(file) {
		fs.writeFileSync(file, this.html);
	}
	
	writePDF(file) {
		fs.writeFileSync(file, this.pdf)
	}
}

exports = module.exports = MarkdownToPDF;
