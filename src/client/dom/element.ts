import { ScramjetClient } from "../client";
import { config, decodeUrl, htmlRules } from "../shared";
import {
	encodeUrl,
	rewriteCss,
	rewriteHtml,
	rewriteJs,
	rewriteSrcset,
} from "../shared";

declare global {
	interface Element {
		$origattrs: Record<string, string>;
	}
}
export default function (client: ScramjetClient, self: typeof window) {
	const attrObject = {
		nonce: [self.HTMLElement],
		integrity: [self.HTMLScriptElement, self.HTMLLinkElement],
		csp: [self.HTMLIFrameElement],
		src: [
			self.HTMLImageElement,
			self.HTMLMediaElement,
			self.HTMLIFrameElement,
			self.HTMLEmbedElement,
			self.HTMLScriptElement,
		],
		href: [self.HTMLAnchorElement, self.HTMLLinkElement],
		data: [self.HTMLObjectElement],
		action: [self.HTMLFormElement],
		formaction: [self.HTMLButtonElement, self.HTMLInputElement],
		srcdoc: [self.HTMLIFrameElement],
		srcset: [self.HTMLImageElement, self.HTMLSourceElement],
		imagesrcset: [self.HTMLLinkElement],
	};

	const attrs = Object.keys(attrObject);

	for (const attr of attrs) {
		for (const element of attrObject[attr]) {
			const descriptor = Object.getOwnPropertyDescriptor(
				element.prototype,
				attr
			);
			Object.defineProperty(element.prototype, attr, {
				get() {
					if (["src", "data", "href", "action", "formaction"].includes(attr)) {
						return decodeUrl(descriptor.get.call(this));
					}

					return descriptor.get.call(this);
				},

				set(value) {
					if (["nonce", "integrity", "csp"].includes(attr)) {
						return;
					} else if (
						["src", "data", "href", "action", "formaction"].includes(attr)
					) {
						value = encodeUrl(value);
					} else if (attr === "srcdoc") {
						value = rewriteHtml(value, client.cookieStore, undefined, true);
					} else if (["srcset", "imagesrcset"].includes(attr)) {
						value = rewriteSrcset(value);
					}

					descriptor.set.call(this, value);
				},
			});
		}
	}

	client.Proxy("Element.prototype.setAttribute", {
		apply(ctx) {
			const [name, value] = ctx.args;

			const rule = htmlRules.find((rule) => {
				let r = rule[name];
				if (!r) return false;
				if (r === "*") return true;
				if (typeof r === "function") return false; // this can't happen but ts

				return r.includes(ctx.this.tagName.toLowerCase());
			});

			if (rule) {
				ctx.args[1] = rule.fn(value, client.url, client.cookieStore);
				ctx.fn.call(ctx.this, `data-scramjet-${ctx.args[0]}`, value);
			}
		},
	});

	client.Proxy("Element.prototype.getAttribute", {
		apply(ctx) {
			const [name] = ctx.args;

			if (ctx.fn.call(ctx.this, `data-scramjet-${name}`)) {
				ctx.return(ctx.fn.call(ctx.this, `data-scramjet-${name}`));
			}
		},
	});

	const innerHTML = Object.getOwnPropertyDescriptor(
		self.Element.prototype,
		"innerHTML"
	);

	Object.defineProperty(self.Element.prototype, "innerHTML", {
		set(value) {
			if (this instanceof self.HTMLScriptElement) {
				value = rewriteJs(value);
			} else if (this instanceof self.HTMLStyleElement) {
				value = rewriteCss(value);
			} else {
				value = rewriteHtml(value, client.cookieStore);
			}

			return innerHTML.set.call(this, value);
		},
	});

	client.Trap("HTMLIFrameElement.prototype.contentWindow", {
		get(ctx) {
			const realwin = ctx.get() as Window;

			if (ScramjetClient.SCRAMJET in realwin.self) {
				return realwin.self[ScramjetClient.SCRAMJET].windowProxy;
			} else {
				// hook the iframe
				const newclient = new ScramjetClient(realwin.self);
				newclient.hook();

				return newclient.globalProxy;
			}
		},
	});

	client.Trap("HTMLIFrameElement.prototype.contentDocument", {
		get(ctx) {
			const contentwindow =
				client.descriptors["HTMLIFrameElement.prototype.contentWindow"].get;
			const realwin = contentwindow.apply(ctx.this);

			if (ScramjetClient.SCRAMJET in realwin.self) {
				return realwin.self[ScramjetClient.SCRAMJET].documentProxy;
			} else {
				const newclient = new ScramjetClient(realwin.self);
				newclient.hook();

				return newclient.documentProxy;
			}
		},
	});

	client.Trap("TreeWalker.prototype.currentNode", {
		get(ctx) {
			return ctx.get();
		},
		set(ctx, value) {
			if (value == client.documentProxy) {
				return ctx.set(self.document);
			}

			return ctx.set(value);
		},
	});

	client.Trap("Node.prototype.ownerDocument", {
		get(ctx) {
			let doc = ctx.get() as Document | null;
			if (!doc) return null;

			let scram: ScramjetClient = doc[ScramjetClient.SCRAMJET];
			if (!scram) return doc; // ??

			return scram.documentProxy;
		},
	});
}
