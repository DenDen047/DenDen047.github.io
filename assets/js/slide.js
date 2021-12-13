var swiper = new Swiper(".mySwiper", {
	slidesPerView: 1,
	spaceBetween: 0,
	centeredSlides: true,
	freeMode: false,
	grabCursor: true,
	loop: true,
	pagination: {
	  el: ".swiper-pagination",
	  clickable: true
	},
	autoplay: {
	  delay: 4000,
	  disableOnInteraction: false
	},
	breakpoints: {
	  500: {
		slidesPerView: 1
	  },
	  700: {
		slidesPerView: 1
	  }
	}
  });

  var swiper = new Swiper('.bottomSlider', {
	slidesPerView: 1,
	spaceBetween: 8,
	loop: true,
	navigation: {
	  nextEl: '.button-next',
	  prevEl: '.button-prev',
	},
	autoplay: {
	  delay: 4000,
	  disableOnInteraction: false
	},
	breakpoints: {
	  500: {
		slidesPerView: 1
	  },
	  700: {
		slidesPerView: 2
	  }
	}
});


  