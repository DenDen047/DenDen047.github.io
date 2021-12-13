$(window).scroll(function(event) {
    var scroll_position = $(window).scrollTop();
    if (scroll_position > 100) {
        $(".logo-sp").removeClass("logo-sp-origin");
        $(".logo-sp").addClass("logo-sp-change");
    } else {
        $(".logo-sp").removeClass("logo-sp-change");
        $(".logo-sp").addClass("logo-sp-origin");

    }
});